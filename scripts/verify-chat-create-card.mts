/**
 * Live verification of §5.M G5/wave-2b — the chat agent does autonomous BOARD work at runtime: it actually creates a
 * kanban card via the `create_card` tool against a live local model ("use the project/card/task structure").
 *
 * Drives the REAL tool-using CLI agent (`nklein chat --workspace <dir> --allow-commands`, the can-act mode where the
 * control_plane `create_card` is allowed) against a live model, asking it to create a card with a distinctive title.
 * It then asserts (a) the agent USED create_card and (b) the card with that exact title is actually persisted on the
 * project board (read back via loadWorkspaceState) — which is only possible if the tool genuinely executed and mutated
 * the board.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-chat-create-card.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default LM Studio), NKLEIN_VERIFY_TIMEOUT_MS (default 180000).
 */
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadWorkspaceState } from "../src/state/workspace-state";

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);

const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "180000");
const CARD_TITLE = "LIVE-CARD-4242-XYZ";

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
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify).`);
	}
	const modelId = await resolveModelId();
	log(`Model: ${modelId}  BaseUrl: ${BASE_URL}`);

	const workspace = await mkdtemp(join(tmpdir(), "nklein-verify-card-"));
	await writeFile(join(workspace, "README.md"), "# Demo project\n\nA tiny project for the live create_card check.\n", "utf8");
	// A real project is a git repo; init one so the workspace resolves like a normal project.
	await execFileAsync("git", ["-C", workspace, "init", "-q"]);
	await execFileAsync("git", ["-C", workspace, "config", "user.email", "verify@nklein.local"]);
	await execFileAsync("git", ["-C", workspace, "config", "user.name", "nklein-verify"]);
	await execFileAsync("git", ["-C", workspace, "add", "-A"]);
	await execFileAsync("git", ["-C", workspace, "commit", "-q", "-m", "seed"]);
	log(`Workspace: ${workspace}  (empty board)`);

	const cliEntry = resolve(process.cwd(), "src/cli.ts");
	const tsxLoader = pathToFileURL(requireFromHere.resolve("tsx")).href;
	const instruction = `Use the create_card tool to create a new card titled exactly "${CARD_TITLE}" with the prompt "live test card". Then reply confirming you created it.`;

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
	// create_card needs no confirm (control_plane auto-allows in this mode); approve any run_command prompt anyway.
	child.stdin.write("y\ny\ny\ny\n");
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

	const usedCreateCard = /\(used:[^)\n]*create_card/.test(stdout);
	const cardOnBoard = await boardHasCardTitled(workspace, CARD_TITLE).catch(() => false);

	await rm(workspace, { recursive: true, force: true }).catch(() => null);

	log("");
	log("=== Chat agent create_card (autonomous board work) result ===");
	log(`Exit code: ${exitCode}`);
	log(`Agent USED create_card: ${usedCreateCard ? "YES ✓" : "NO ⚠️"}`);
	log(`Card "${CARD_TITLE}" persisted on the board (read back via loadWorkspaceState): ${cardOnBoard ? "YES ✓" : "NO ⚠️"}`);
	if (!usedCreateCard || !cardOnBoard) {
		log("--- stdout (tail) ---");
		log(stdout.slice(-1200));
		if (stderr.trim()) {
			log("--- stderr (tail) ---");
			log(stderr.slice(-600));
		}
	}

	const ok = usedCreateCard && cardOnBoard;
	log("");
	log(ok ? "PASS ✓ the chat agent created a real board card at runtime." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
