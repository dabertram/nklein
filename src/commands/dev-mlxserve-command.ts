/**
 * `nklein dev mlxserve <start|stop|status>` — the managed mlx-serve lifecycle (P17.7 residency budgets).
 *
 * This command is the ENFORCING CONSUMER of the persisted `kvCacheDiskGb` setting: the disk budget a user
 * types in Settings flows into the real `--prefix-cache-disk` flag of a real server process, instead of
 * living as an advisory string. It is deliberately DEV-TIME tooling — the standing production rule is
 * "recommendation-only, never auto-load/unload", so !Klein's runtime never launches or kills this process
 * itself; the operator does, through here, and the runtime merely discovers the endpoint like any other
 * custom provider (the P17.1 probe proved that path end to end, 2026-08-04).
 *
 * Guard rails, each load-bearing:
 *  - LOCAL-ONLY: the bind host is HARDCODED to 127.0.0.1 (prime directive; no flag can widen it).
 *  - NO AUTO-DOWNLOAD: a missing binary prints the install recipe (model/binary downloads happen only as an
 *    explicit operator act — the July delegation rule); this command never fetches anything.
 *  - HONEST LIFECYCLE: a pidfile under `~/.nklein/nklein/mlx-serve/` owns exactly one managed instance;
 *    start refuses while one is alive, stop escalates SIGTERM→SIGKILL with a bounded wait, and status
 *    probes the real `/v1/models` endpoint rather than trusting the pidfile alone.
 *  - The bare `mlx-serve --model` invocation is INTERACTIVE chat (it dies on stdin EOF when detached —
 *    three silent rig deaths before that diagnosis, 2026-08-04); only the `serve` subcommand is ever used.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadGlobalRuntimeConfig } from "../config/runtime-config";

/** Where the managed instance's pidfile/log live (sibling convention: egress-receipt-store). */
export function mlxServeStateDir(home: string = homedir()): string {
	return join(home, ".nklein", "nklein", "mlx-serve");
}

/** The conventional install location the recipe targets (checked after the flag and the env override). */
export function mlxServeDefaultBinaryPath(home: string = homedir()): string {
	return join(home, ".nklein", "nklein", "tools", "mlx-serve", "mlx-serve");
}

/**
 * Ordered binary candidates: explicit `--binary` flag, then `NKLEIN_MLX_SERVE_BIN` (env wins over
 * convention, matching the config precedence used everywhere else), then the conventional install path.
 */
export function resolveMlxServeBinaryCandidates(input: {
	flagPath?: string | null;
	env?: NodeJS.ProcessEnv;
	home?: string;
}): string[] {
	const env = input.env ?? process.env;
	return [
		input.flagPath?.trim() || null,
		env.NKLEIN_MLX_SERVE_BIN?.trim() || null,
		mlxServeDefaultBinaryPath(input.home),
	].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
}

/**
 * The serve argv — pure so the disk-budget flow is testable: `diskGb` (the persisted `kvCacheDiskGb`
 * setting, or the `--disk-gb` override) becomes `--prefix-cache-disk <N>GB`; null omits the tier entirely.
 * Host is NOT a parameter by design (local-only).
 */
export function buildMlxServeServeArgs(input: { modelDir: string; port: number; diskGb: number | null }): string[] {
	const args = ["serve", "--model-dir", input.modelDir, "--host", "127.0.0.1", "--port", String(input.port)];
	if (input.diskGb !== null && input.diskGb > 0) {
		args.push("--prefix-cache-disk", `${Math.trunc(input.diskGb)}GB`);
	}
	return args;
}

interface MlxServePidfile {
	pid: number;
	port: number;
	modelDir: string;
	diskGb: number | null;
	binary: string;
	logPath: string;
	startedAt: number;
}

function pidfilePath(stateDir: string): string {
	return join(stateDir, "instance.json");
}

async function readPidfile(stateDir: string): Promise<MlxServePidfile | null> {
	try {
		const raw = await readFile(pidfilePath(stateDir), "utf8");
		const parsed = JSON.parse(raw) as MlxServePidfile;
		return typeof parsed?.pid === "number" && typeof parsed?.port === "number" ? parsed : null;
	} catch {
		return null;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function probeModels(port: number, timeoutMs: number): Promise<{ ids: string[]; loaded: number } | null> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			return null;
		}
		const body = (await response.json()) as { data?: Array<{ id?: unknown; loaded?: unknown }> };
		const models = Array.isArray(body?.data) ? body.data : [];
		return {
			ids: models.map((model) => (typeof model.id === "string" ? model.id : "?")),
			loaded: models.filter((model) => model.loaded === true).length,
		};
	} catch {
		return null;
	}
}

const INSTALL_RECIPE = [
	"mlx-serve binary not found. This command NEVER downloads anything itself (binary/model fetches are an",
	"explicit operator act). Install it once:",
	"  mkdir -p ~/.nklein/nklein/tools/mlx-serve",
	"  tar -xzf <mlx-serve release tarball (e.g. releases/v26.7.11/mlx-serve-bin-macos-arm64.tar.gz)> \\",
	"      -C ~/.nklein/nklein/tools/mlx-serve --strip-components 1",
	"or point --binary / NKLEIN_MLX_SERVE_BIN at an existing extraction.",
].join("\n");

export async function runDevMlxServeCommand(
	action: string,
	options: {
		modelDir?: string;
		port?: string;
		binary?: string;
		diskGb?: string;
		json?: boolean;
	},
): Promise<void> {
	const stateDir = mlxServeStateDir();
	const port = Number(options.port ?? "11234");
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		process.stderr.write(`Invalid --port ${options.port}.\n`);
		process.exitCode = 1;
		return;
	}

	if (action === "status") {
		const pidfile = await readPidfile(stateDir);
		const alive = pidfile ? isProcessAlive(pidfile.pid) : false;
		const health = pidfile && alive ? await probeModels(pidfile.port, 5_000) : null;
		let kvCacheBytes = 0;
		try {
			const kvDir = join(homedir(), ".mlx-serve", "kv-cache");
			const entries = await stat(kvDir);
			kvCacheBytes = entries.isDirectory() ? -1 : 0; // -1 = present (sizing a tree here would be slow)
		} catch {
			kvCacheBytes = 0;
		}
		const summary = {
			managed: pidfile !== null,
			alive,
			pid: pidfile?.pid ?? null,
			port: pidfile?.port ?? null,
			modelDir: pidfile?.modelDir ?? null,
			diskGb: pidfile?.diskGb ?? null,
			healthy: health !== null,
			models: health?.ids ?? [],
			loadedModels: health?.loaded ?? 0,
			kvCacheDirPresent: kvCacheBytes === -1,
		};
		if (options.json) {
			process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
		} else if (!pidfile) {
			process.stdout.write(
				"No managed mlx-serve instance (no pidfile). Start one with `dev mlxserve start --model-dir …`.\n",
			);
		} else {
			process.stdout.write(
				`mlx-serve pid ${pidfile.pid} (${alive ? "alive" : "DEAD"}) on 127.0.0.1:${pidfile.port} — ` +
					`${health ? `healthy, ${health.ids.length} model(s), ${health.loaded} loaded` : "NOT answering /v1/models"}; ` +
					`disk tier ${pidfile.diskGb ? `${pidfile.diskGb}GB` : "off"}; log ${pidfile.logPath}\n`,
			);
		}
		return;
	}

	if (action === "stop") {
		const pidfile = await readPidfile(stateDir);
		if (!pidfile || !isProcessAlive(pidfile.pid)) {
			process.stdout.write(pidfile ? "Managed instance already dead; clearing pidfile.\n" : "Nothing to stop.\n");
			await rm(pidfilePath(stateDir), { force: true });
			return;
		}
		process.kill(pidfile.pid, "SIGTERM");
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline && isProcessAlive(pidfile.pid)) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		if (isProcessAlive(pidfile.pid)) {
			process.kill(pidfile.pid, "SIGKILL");
		}
		await rm(pidfilePath(stateDir), { force: true });
		process.stdout.write(`Stopped mlx-serve pid ${pidfile.pid}.\n`);
		return;
	}

	if (action !== "start") {
		process.stderr.write(`Unknown action "${action}" — use start | stop | status.\n`);
		process.exitCode = 1;
		return;
	}

	const existing = await readPidfile(stateDir);
	if (existing && isProcessAlive(existing.pid)) {
		process.stderr.write(
			`A managed mlx-serve is already running (pid ${existing.pid}, port ${existing.port}). Stop it first: dev mlxserve stop\n`,
		);
		process.exitCode = 1;
		return;
	}

	const binary = resolveMlxServeBinaryCandidates({ flagPath: options.binary }).find((candidate) =>
		existsSync(candidate),
	);
	if (!binary) {
		process.stderr.write(`${INSTALL_RECIPE}\n`);
		process.exitCode = 1;
		return;
	}

	const modelDir = options.modelDir?.trim() || process.env.NKLEIN_MLX_MODEL_DIR?.trim();
	if (!modelDir || !existsSync(modelDir)) {
		process.stderr.write(
			`--model-dir is required (a directory of MLX models; typically a vendor dir under ~/.lmstudio/models).${modelDir ? ` "${modelDir}" does not exist.` : ""}\n`,
		);
		process.exitCode = 1;
		return;
	}

	// THE BUDGET FLOW: --disk-gb flag wins; else the persisted Settings value (`kvCacheDiskGb`); else off.
	let diskGb: number | null = null;
	if (options.diskGb !== undefined) {
		const parsed = Math.trunc(Number(options.diskGb));
		diskGb = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	} else {
		const config = await loadGlobalRuntimeConfig().catch(() => null);
		diskGb = config?.kvCacheDiskGb ?? null;
	}

	await mkdir(stateDir, { recursive: true });
	const logPath = join(stateDir, "serve.log");
	const args = buildMlxServeServeArgs({ modelDir, port, diskGb });
	const { openSync } = await import("node:fs");
	const logFd = openSync(logPath, "a");
	const child = spawn(binary, args, {
		detached: true,
		stdio: ["ignore", logFd, logFd],
	});
	child.unref();
	if (typeof child.pid !== "number") {
		process.stderr.write("Failed to spawn mlx-serve (no pid).\n");
		process.exitCode = 1;
		return;
	}
	const pidfile: MlxServePidfile = {
		pid: child.pid,
		port,
		modelDir,
		diskGb,
		binary,
		logPath,
		startedAt: Date.now(),
	};
	await writeFile(pidfilePath(stateDir), `${JSON.stringify(pidfile, null, 2)}\n`, "utf8");

	// Bounded readiness wait — generous (m5max low-power discipline): 60s of 2s probes.
	let health: { ids: string[]; loaded: number } | null = null;
	for (let attempt = 0; attempt < 30; attempt += 1) {
		health = await probeModels(port, 2_000);
		if (health) {
			break;
		}
		if (!isProcessAlive(child.pid)) {
			process.stderr.write(`mlx-serve exited during startup — see ${logPath}\n`);
			await rm(pidfilePath(stateDir), { force: true });
			process.exitCode = 1;
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	if (!health) {
		process.stderr.write(
			`mlx-serve did not answer /v1/models within 60s (still running, pid ${child.pid}) — see ${logPath}\n`,
		);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(
		`mlx-serve up: pid ${child.pid} on 127.0.0.1:${port}, ${health.ids.length} model(s) discovered` +
			`${diskGb ? `, disk prefix tier ${diskGb}GB (from ${options.diskGb !== undefined ? "--disk-gb" : "Settings kvCacheDiskGb"})` : ", disk prefix tier OFF (set kvCacheDiskGb in Settings to enable)"}.\n`,
	);
	for (const id of health.ids.slice(0, 8)) {
		process.stdout.write(`  - ${id}\n`);
	}
	process.stdout.write(
		`Add it as a custom provider (baseUrl http://127.0.0.1:${port}/v1) to route !Klein sessions through it.\n`,
	);
}
