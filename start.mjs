#!/usr/bin/env node
/**
 * !Klein dev launcher — the SINGLE cross-platform entry point (start.sh / start.bat are thin wrappers that just exec
 * this). Replaces the hand-rolled `case` arg parsing in start.sh (and start.bat, which parsed no args at all) with
 * Node's built-in `util.parseArgs` — one strict, self-documenting arg definition shared across every OS.
 *
 * Behavior (faithful to the previous scripts):
 *   - flags: --force/-f (kill a stale instance without asking), --test/-t (isolated test instance on offset ports +
 *     its own data dir), --help/-h.
 *   - env preflight (node >= 22, npm, git; docker is a soft warning) — was start.bat-only, now on every OS.
 *   - stale-instance detection on the dev ports (a leftover instance serves OLD code because it doesn't hot-reload);
 *     prompt to stop it, or --force to stop automatically. Skipped in --test mode (it uses offset ports).
 *   - installs deps if any of the three node_modules trees are missing, then `npm run dev:full`.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

// Default dev ports (scripts/dev-full.mjs: tsx src/cli.ts runtime + Vite UI).
const RUNTIME_PORT = 3484;
const WEB_UI_PORT = 4173;
// --test offsets: a fully isolated instance that coexists with the main one.
const TEST_RUNTIME_PORT = 3584;
const TEST_WEB_UI_PORT = 4273;
const MIN_NODE_MAJOR = 22;

const HELP = `Usage: ./start.sh [--force] [--test]   (Windows: start.bat …;  or: node start.mjs …)
  Starts !Klein in full dev mode (runtime :${RUNTIME_PORT} + Vite UI :${WEB_UI_PORT}). Detects a
  leftover dev instance from a previous run and offers to shut it down first
  (a stale instance does not hot-reload, so it silently serves old code).
  --force, -f   Shut down any stale instance without asking.
  --test,  -t   Spawn an ISOLATED TEST instance ALONGSIDE your main one:
                offset ports (runtime :${TEST_RUNTIME_PORT} + UI :${TEST_WEB_UI_PORT}) + a separate data dir
                (.nklein-test-home/.nklein) — never touches your real board and
                never kills the main instance. Then open http://127.0.0.1:${TEST_WEB_UI_PORT}.`;

/** Parse argv strictly — an unknown flag is a hard error (unlike the old lenient `case`), with a helpful message. */
function parseCliArgs() {
	try {
		const { values } = parseArgs({
			options: {
				force: { type: "boolean", short: "f", default: false },
				test: { type: "boolean", short: "t", default: false },
				help: { type: "boolean", short: "h", default: false },
			},
			allowPositionals: false,
			strict: true,
		});
		return values;
	} catch (error) {
		console.error(`start: ${error instanceof Error ? error.message : String(error)}\n`);
		console.error(HELP);
		process.exit(64); // EX_USAGE
	}
}

/** True when `cmd` resolves on PATH (cross-platform: `where` on Windows, `command -v` on POSIX). */
function commandExists(cmd) {
	const probe =
		process.platform === "win32"
			? spawnSync("where", [cmd], { stdio: "ignore" })
			: spawnSync("command", ["-v", cmd], { stdio: "ignore", shell: true });
	return probe.status === 0;
}

/** Run a command, capture stdout (trimmed), never throw; returns "" on failure. */
function capture(cmd, args) {
	const out = spawnSync(cmd, args, { encoding: "utf8" });
	return out.status === 0 ? (out.stdout ?? "").trim() : "";
}

/** Preflight the toolchain (node >= 22, npm, git required; docker a soft warning). Exits non-zero on a hard failure. */
function checkEnvironment() {
	const nodeMajor = Number(process.versions.node.split(".")[0]);
	if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
		console.error(`Node.js ${MIN_NODE_MAJOR} or newer is required. Found: ${process.version}`);
		process.exit(1);
	}
	for (const tool of ["npm", "git"]) {
		if (!commandExists(tool)) {
			console.error(`${tool} was not found on PATH. Install it, then run start again.`);
			process.exit(1);
		}
	}
	if (!commandExists("docker")) {
		console.warn("Warning: Docker was not found on PATH. !Klein can start, but agent tasks require Docker.");
	} else if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
		console.warn("Warning: Docker is not reachable. Start Docker before running agent tasks.");
	}
}

/** PIDs LISTENING on `port` (cross-platform: lsof on POSIX, netstat on Windows). Never throws; [] on none/error. */
function listeningPids(port) {
	if (process.platform === "win32") {
		const out = capture("netstat", ["-ano", "-p", "tcp"]);
		const pids = new Set();
		for (const line of out.split(/\r?\n/)) {
			if (line.includes("LISTENING") && new RegExp(`:${port}\\b`).test(line)) {
				const pid = line.trim().split(/\s+/).pop();
				if (pid && /^\d+$/.test(pid)) pids.add(pid);
			}
		}
		return [...pids];
	}
	const out = capture("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
	return out
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => /^\d+$/.test(s));
}

/** The stale dev-stack PIDs: whatever is LISTENING on either dev port (a running instance binds both). Deduped. */
function collectStalePids() {
	return [...new Set([...listeningPids(RUNTIME_PORT), ...listeningPids(WEB_UI_PORT)])];
}

function describePid(pid) {
	const info =
		process.platform === "win32"
			? capture("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"])
			: capture("ps", ["-p", pid, "-o", "pid=,command="]);
	return `  ${(info.split(/\r?\n/)[0] ?? `pid ${pid}`).trim()}`.slice(0, 120);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** SIGTERM the PIDs, wait up to ~5s for the ports to free, then SIGKILL survivors. Aborts the launch if any remain. */
async function stopStaleInstance(pids) {
	console.log("Stopping stale instance(s)...");
	for (const pid of pids) {
		try {
			process.kill(Number(pid), "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	for (let i = 0; i < 5; i++) {
		await sleep(1000);
		if (collectStalePids().length === 0) break;
	}
	for (const pid of collectStalePids()) {
		try {
			process.kill(Number(pid), "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	await sleep(1000);
	if (collectStalePids().length > 0) {
		console.error("Could not stop every stale process; aborting so we don't run two instances.");
		process.exit(1);
	}
	console.log("Stale instance(s) stopped.");
}

/** Prompt y/N on the TTY; resolves true on yes. Defaults to No (also when there is no interactive TTY). */
function confirm(question) {
	return new Promise((resolve) => {
		if (!process.stdin.isTTY) {
			resolve(false);
			return;
		}
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		rl.question(question, (answer) => {
			rl.close();
			resolve(/^(y|yes)$/i.test(answer.trim()));
		});
	});
}

/** `npm run <script>` inheriting stdio, with optional extra env; returns the child's exit code. */
function runNpm(script, extraEnv = {}) {
	const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
		cwd: ROOT_DIR,
		stdio: "inherit",
		env: { ...process.env, ...extraEnv },
	});
	return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 0)));
}

async function main() {
	const args = parseCliArgs();
	if (args.help) {
		console.log(HELP);
		return;
	}
	process.chdir(ROOT_DIR);
	checkEnvironment();

	// A --test instance runs on offset ports + an isolated data dir, so it MUST NOT touch the main instance — skip the
	// stale-detection/kill entirely in test mode.
	if (!args.test) {
		const stale = collectStalePids();
		if (stale.length > 0) {
			console.log(`Detected a running !Klein dev instance (ports ${RUNTIME_PORT}/${WEB_UI_PORT}):`);
			for (const pid of stale) console.log(describePid(pid));
			if (args.force || (await confirm("Shut it down and start fresh? [y/N] "))) {
				await stopStaleInstance(stale);
			} else {
				console.error("Left the existing instance running. Aborting (it would bind the same ports).");
				console.error("Re-run with --force to shut it down automatically.");
				process.exit(1);
			}
		}
	}

	if (
		!existsSync(join(ROOT_DIR, "node_modules")) ||
		!existsSync(join(ROOT_DIR, "web-ui", "node_modules")) ||
		!existsSync(join(ROOT_DIR, "packages", "desktop", "node_modules"))
	) {
		console.log("Installing dependencies (root, web-ui, desktop)...");
		const code = await runNpm("install:all");
		if (code !== 0) process.exit(code);
	}

	if (args.test) {
		const testHome = join(ROOT_DIR, ".nklein-test-home");
		await mkdir(testHome, { recursive: true });
		console.log("Starting !Klein ISOLATED TEST instance...");
		console.log(`  data dir: ${join(testHome, ".nklein")}   ports: runtime ${TEST_RUNTIME_PORT} / UI ${TEST_WEB_UI_PORT}`);
		console.log(`  (separate from your main board; coexists with a running main instance) — open http://127.0.0.1:${TEST_WEB_UI_PORT}`);
		const code = await runNpm("dev:full", {
			HOME: testHome,
			USERPROFILE: testHome, // Windows equivalent of HOME
			NKLEIN_DEV_ISOLATED: "1",
			NKLEIN_DEV_RUNTIME_PORT: String(TEST_RUNTIME_PORT),
			NKLEIN_DEV_WEB_UI_PORT: String(TEST_WEB_UI_PORT),
		});
		process.exit(code);
	}

	console.log("Starting !Klein in full dev mode...");
	process.exit(await runNpm("dev:full"));
}

main().catch((error) => {
	console.error(`start: ${error instanceof Error ? error.stack || error.message : String(error)}`);
	process.exit(1);
});
