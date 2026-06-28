/**
 * Live END-TO-END verification of §5.M G7 — the FULL tool-using chat agent composes multiple tools in a single
 * session at runtime (user: "make sure we cover everything properly" + "test if things execute at runtime").
 *
 * Drives the REAL CLI agent (`nklein chat --workspace <dir> --allow-commands`) against a live local model with one
 * multi-step instruction that exercises the whole stack: read a file, run a shell command + see its output, create a
 * board card, and maintain a focus chain. It then asserts the durable side effects actually happened — the file
 * marker flowed back into the reply (read + command executed) AND the card persisted on the board (control-plane
 * mutation executed) — plus that the agent used each tool. This is only possible if the tools genuinely executed and
 * their results flowed back into the model's context across turns.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-chat-agent-e2e.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default LM Studio), NKLEIN_VERIFY_TIMEOUT_MS (default 240000).
 */
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadWorkspaceState } from "../src/state/workspace-state";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);

const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "240000");
const FILE_MARKER = "ECHO-MARKER-7777-XYZ";
const CARD_TITLE = "E2E-CARD-7777";

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function resolveModelId(): Promise<string> {
	if (MODEL_ID) {
		return MODEL_ID;
	}
	const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	const id = payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

async function boardHasCardTitled(workspace: string, title: string): Promise<boolean> {
	const state = await loadWorkspaceState(workspace);
	return state.board.columns.some((column) => column.cards.some((card) => card.title?.trim() === title));
}

async function main(): Promise<void> {
	// Never load models — only test already-loaded ones (user directive 2026-06-28). Refuse a specified non-resident model.
	if (MODEL_ID) {
		await assertModelLoaded(BASE_URL, MODEL_ID);
	}
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify).`);
	}
	const modelId = await resolveModelId();
	log(`Model: ${modelId}  BaseUrl: ${BASE_URL}`);

	const workspace = await mkdtemp(join(tmpdir(), "nklein-verify-e2e-"));
	await writeFile(join(workspace, "FACT.txt"), `${FILE_MARKER}\n`, "utf8");
	await writeFile(join(workspace, "README.md"), "# Demo project\n\nA tiny project for the live end-to-end agent check.\n", "utf8");
	await execFileAsync("git", ["-C", workspace, "init", "-q"]);
	await execFileAsync("git", ["-C", workspace, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", workspace, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", workspace, "add", "-A"]);
	await execFileAsync("git", ["-C", workspace, "commit", "-q", "-m", "seed"]);
	log(`Workspace: ${workspace}  (FACT.txt seeded, empty board)`);

	const cliEntry = resolve(process.cwd(), "src/cli.ts");
	const tsxLoader = pathToFileURL(requireFromHere.resolve("tsx")).href;
	const instruction = [
		"Complete ALL of these steps in order, using one tool per step:",
		"1. Use read_file to read FACT.txt.",
		"2. Use run_command to run exactly: cat FACT.txt",
		`3. Use create_card to create a card titled exactly "${CARD_TITLE}" with the prompt "from e2e".`,
		"4. Use update_focus_chain to record the steps you completed.",
		"Then reply with a short summary that includes the exact marker text printed by FACT.txt.",
	].join(" ");

	const child = spawn(
		process.execPath,
		[
			"--import",
			tsxLoader,
			cliEntry,
			"chat",
			"--workspace",
			workspace,
			"--allow-commands",
			"--message",
			instruction,
			"--base-url",
			BASE_URL,
			"--model",
			modelId,
		],
		{ cwd: process.cwd(), env: { ...process.env, NKLEIN_CORE_PY: "0" } },
	);

	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	// run_command is a confirmed host action — approve generously across the multi-step turn.
	child.stdin.write("y\ny\ny\ny\ny\ny\ny\ny\n");
	child.stdin.end();

	const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			rejectExit(new Error(`chat agent did not finish within ${TIMEOUT_MS}ms`));
		}, TIMEOUT_MS);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolveExit(code);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			rejectExit(error);
		});
	}).catch((error: Error) => {
		log(`Spawn error: ${error.message}`);
		return -1;
	});

	const usedRead = /\(used:[^)\n]*read_file/.test(stdout) || /\(used:[^)\n]*list_dir/.test(stdout);
	const usedCommand = /\(used:[^)\n]*run_command/.test(stdout);
	const usedCreateCard = /\(used:[^)\n]*create_card/.test(stdout);
	const usedFocusChain = /\(used:[^)\n]*update_focus_chain/.test(stdout);
	const markerEchoed = stdout.includes(FILE_MARKER);
	const cardOnBoard = await boardHasCardTitled(workspace, CARD_TITLE).catch(() => false);

	await rm(workspace, { recursive: true, force: true }).catch(() => null);

	log("");
	log("=== Full tool-using chat agent (end-to-end) result ===");
	log(`Exit code: ${exitCode}`);
	log(`Used read_file/list_dir:           ${usedRead ? "YES ✓" : "NO ⚠️"}`);
	log(`Used run_command:                  ${usedCommand ? "YES ✓" : "NO ⚠️"}`);
	log(`Used create_card:                  ${usedCreateCard ? "YES ✓" : "NO ⚠️"}`);
	log(`Used update_focus_chain:           ${usedFocusChain ? "YES ✓" : "NO ⚠️"}`);
	log(`Reply echoed the file marker:      ${markerEchoed ? "YES ✓" : "NO ⚠️"}  (read + command executed)`);
	log(`Card "${CARD_TITLE}" persisted:      ${cardOnBoard ? "YES ✓" : "NO ⚠️"}  (control-plane mutation executed)`);

	// PASS gate: the two durable side effects MUST hold (they prove tools actually executed + results flowed back),
	// and the agent must have used all four tool kinds. The side effects are the hard proof; the "used" flags confirm
	// the agent drove each surface.
	const ok = markerEchoed && cardOnBoard && usedRead && usedCommand && usedCreateCard && usedFocusChain;
	if (!ok) {
		log("--- stdout (tail) ---");
		log(stdout.slice(-1800));
		if (stderr.trim()) {
			log("--- stderr (tail) ---");
			log(stderr.slice(-600));
		}
	}
	log("");
	log(ok ? "PASS ✓ the full tool-using chat agent composed read + command + card + focus chain at runtime." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
