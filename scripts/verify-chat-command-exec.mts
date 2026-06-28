/**
 * Live verification of §5.M G2 — the chat agent actually RUNS commands at runtime (user: "agents running commands,
 * test if things execute at runtime").
 *
 * Drives the REAL tool-using CLI agent (`nklein chat --workspace <dir> --allow-commands`) against a live local model.
 * The workspace holds a file with a distinctive marker that the agent can only know by actually running `cat` on it.
 * The harness pipes confirmations to stdin (run_command is a confirmed host action), then asserts the agent (a) USED
 * run_command and (b) its reply contains the marker — which is only possible if the command genuinely executed and its
 * output flowed back into the model's context.
 *
 * Run:  HOME=/tmp/nklein-verify tsx scripts/verify-chat-command-exec.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default LM Studio), NKLEIN_VERIFY_TIMEOUT_MS (default 180000).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";

const requireFromHere = createRequire(import.meta.url);

const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "180000");
const MARKER = "BANANA-MARKER-4242-XYZ";

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

	const workspace = await mkdtemp(join(tmpdir(), "nklein-verify-cmd-"));
	await writeFile(join(workspace, "MARKER.txt"), `${MARKER}\n`, "utf8");
	log(`Workspace: ${workspace}  (MARKER.txt seeded)`);

	const cliEntry = resolve(process.cwd(), "src/cli.ts");
	const tsxLoader = pathToFileURL(requireFromHere.resolve("tsx")).href;
	const instruction =
		"Use the run_command tool to run exactly this shell command: cat MARKER.txt — then reply with the exact text it printed.";

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
	// run_command is a confirmed host action — approve every prompt.
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

	await rm(workspace, { recursive: true, force: true }).catch(() => null);

	const usedRunCommand = /\(used:[^)\n]*run_command/.test(stdout);
	const markerEchoed = stdout.includes(MARKER);

	log("");
	log("=== Chat agent command-execution result ===");
	log(`Exit code: ${exitCode}`);
	log(`Agent USED run_command: ${usedRunCommand ? "YES ✓" : "NO ⚠️"}`);
	log(`Reply echoed the marker (proves the command executed + output flowed back): ${markerEchoed ? "YES ✓" : "NO ⚠️"}`);
	if (!usedRunCommand || !markerEchoed) {
		log("--- stdout (tail) ---");
		log(stdout.slice(-1200));
		if (stderr.trim()) {
			log("--- stderr (tail) ---");
			log(stderr.slice(-600));
		}
	}

	const ok = usedRunCommand && markerEchoed;
	log("");
	log(ok ? "PASS ✓ the chat agent ran a real shell command and saw its output at runtime." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
