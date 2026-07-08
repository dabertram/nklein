/**
 * Starts both the runtime server and Vite web UI dev server on an
 * automatically-selected free port. Use via `npm run dev:full` or the
 * VS Code "Dev (Full Stack)" launch config.
 */
import { createServer, connect } from "node:net";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";

const isWindows = process.platform === "win32";

async function ensureDependenciesInstalled() {
	const lockIndicator = join(process.cwd(), "node_modules", ".package-lock.json");
	try {
		await access(lockIndicator);
		return;
	} catch {
		// node_modules is missing; fall through to install below.
	}
	console.warn("node_modules not installed in this worktree. Running npm ci...");
	for (const args of [["ci"], ["--prefix", "web-ui", "ci"]]) {
		const result = spawnSync("npm", args, { stdio: "inherit", shell: isWindows });
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
	}
}

// Must run before importing any third-party modules so a fresh worktree with
// an empty node_modules can bootstrap itself using only node: built-ins.
await ensureDependenciesInstalled();

// Deferred until after ensureDependenciesInstalled so these resolve against
// the freshly-installed node_modules. Static top-level imports would be
// resolved before any code runs and fail with ERR_MODULE_NOT_FOUND.
const { default: treeKill } = await import("tree-kill");
const { default: open } = await import("open");

const requestedDevFullArgs = process.argv.slice(2);
const withShutdownCleanupFlag = "--with-shutdown-cleanup";
const requestedRuntimeArgs = requestedDevFullArgs.filter((arg) => arg !== withShutdownCleanupFlag);

// Dev-instance knobs (default = the shared 3484/4173 stack; behavior is byte-identical when all unset). A TEST instance
// (spawned by `start.sh --test`) sets these to run ISOLATED, ALONGSIDE the main instance: `NKLEIN_DEV_ISOLATED` skips the
// reach-existing / kill-stale / wait-for-preferred-ports logic (a test instance must NEVER touch the main one), and
// `NKLEIN_DEV_RUNTIME_PORT` / `NKLEIN_DEV_WEB_UI_PORT` move the base ports it searches from. Data isolation is separate
// (start.sh points HOME at a throwaway dir, so the runtime's `~/.nklein` lands there).
const devInstanceIsolated = /^(1|true|yes|on)$/i.test(process.env.NKLEIN_DEV_ISOLATED ?? "");
const baseRuntimePort = Number.parseInt(process.env.NKLEIN_DEV_RUNTIME_PORT ?? "", 10) || 3484;
const baseWebUiPort = Number.parseInt(process.env.NKLEIN_DEV_WEB_UI_PORT ?? "", 10) || 4173;
const requestedLanHost = process.env.NKLEIN_LAN_HOST?.trim() || "";
const runtimeBindHost =
	process.env.NKLEIN_RUNTIME_HOST?.trim() || process.env.KANBAN_RUNTIME_HOST?.trim() || requestedLanHost || "127.0.0.1";
const webUiBindHost =
	process.env.NKLEIN_WEB_UI_HOST?.trim() || process.env.KANBAN_WEB_UI_HOST?.trim() || requestedLanHost || "127.0.0.1";

function isWildcardHost(host) {
	return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function firstLanAddress() {
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) {
				return entry.address;
			}
		}
	}
	return null;
}

function authority(host, port) {
	const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `${normalizedHost}:${port}`;
}

const detectedLanHost = firstLanAddress();
const runtimePublicHost =
	process.env.NKLEIN_RUNTIME_PUBLIC_HOST?.trim() ||
	(isWildcardHost(runtimeBindHost) ? detectedLanHost || "127.0.0.1" : runtimeBindHost);
const runtimeConnectHost = isWildcardHost(runtimeBindHost) ? "127.0.0.1" : runtimeBindHost;
const webUiConnectHost = isWildcardHost(webUiBindHost) ? "127.0.0.1" : webUiBindHost;
const webUiPublicHost =
	process.env.NKLEIN_WEB_UI_PUBLIC_HOST?.trim() ||
	(isWildcardHost(webUiBindHost) ? detectedLanHost || webUiConnectHost : webUiBindHost);

function parseProcessList(output) {
	return output
		.split("\n")
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
			if (!match) {
				return null;
			}
			return {
				pid: Number(match[1]),
				ppid: Number(match[2]),
				command: match[3],
			};
		})
		.filter(Boolean);
}

function treeKillAsync(pid, signal = "SIGTERM") {
	return new Promise((resolve) => {
		treeKill(pid, signal, () => resolve(undefined));
	});
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForProcessesToExit(pids, timeoutMs = 2500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (pids.every((pid) => !isProcessRunning(pid))) {
			return [];
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return pids.filter((pid) => isProcessRunning(pid));
}

async function stopStaleDevProcesses() {
	if (isWindows) {
		return;
	}

	const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) {
		return;
	}

	const repoRoot = process.cwd();
	const currentPids = new Set([process.pid, process.ppid]);
	const processes = parseProcessList(result.stdout);
	const processesByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
	const stalePids = new Set();
	const isKillablePid = (pid) => pid > 1 && !currentPids.has(pid);

	for (const processInfo of processes) {
		if (!isKillablePid(processInfo.pid)) {
			continue;
		}
		const isRuntimeChild =
			processInfo.command.includes(`${repoRoot}/node_modules/tsx`) &&
			processInfo.command.includes("src/cli.ts") &&
			processInfo.command.includes("--no-open");
		const isViteChild = processInfo.command.includes(`${repoRoot}/web-ui/node_modules/.bin/vite`);
		const isDevFullChild = processInfo.command.includes(`${repoRoot}/scripts/dev-full.mjs`);
		if (!isRuntimeChild && !isViteChild && !isDevFullChild) {
			continue;
		}

		stalePids.add(processInfo.pid);
		const parent = processesByPid.get(processInfo.ppid);
		if (parent && isKillablePid(parent.pid)) {
			stalePids.add(parent.pid);
		}
	}

	if (stalePids.size === 0) {
		return;
	}

	console.log(`Stopping stale nKlein dev process${stalePids.size === 1 ? "" : "es"}: ${[...stalePids].join(", ")}`);
	await Promise.allSettled([...stalePids].map((pid) => treeKillAsync(pid)));
	const remainingPids = await waitForProcessesToExit([...stalePids]);
	if (remainingPids.length > 0) {
		await Promise.allSettled(remainingPids.map((pid) => treeKillAsync(pid, "SIGKILL")));
		await waitForProcessesToExit(remainingPids, 1000);
	}
}

function findPort(start, reserved = new Set(), host = "127.0.0.1") {
	if (reserved.has(start)) {
		return findPort(start + 1, reserved, host);
	}
	return new Promise((resolve) => {
		const srv = createServer();
		srv.listen(start, host, () => {
			srv.close(() => resolve(start));
		});
		srv.on("error", () => resolve(findPort(start + 1, reserved, host)));
	});
}

function waitForPort(port, timeout = 15000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		function attempt() {
			const sock = connect(port, runtimeConnectHost);
			sock.on("connect", () => {
				sock.destroy();
				resolve();
			});
			sock.on("error", () => {
				if (Date.now() - start > timeout) {
					reject(new Error(`Runtime did not start within ${timeout}ms`));
				} else {
					setTimeout(attempt, 200);
				}
			});
		}
		attempt();
	});
}

async function waitForPreferredDevPortsToSettle(timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const runtimePortAvailable = await findPort(baseRuntimePort, new Set(), runtimeBindHost);
		const webUiPortAvailable = await findPort(baseWebUiPort, new Set(), webUiBindHost);
		if (runtimePortAvailable === baseRuntimePort && webUiPortAvailable === baseWebUiPort) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function canReachExistingDevServer(timeoutMs = 3000) {
	try {
		const response = await fetch(`http://${authority(webUiConnectHost, baseWebUiPort)}/api/trpc/projects.list`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			return false;
		}
		await response.arrayBuffer();
	} catch {
		return false;
	}

	return await new Promise((resolve) => {
		let settled = false;
		const socket = new WebSocket(`ws://${authority(webUiConnectHost, baseWebUiPort)}/api/runtime/ws`);
		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			socket.close();
			resolve(false);
		}, timeoutMs);
		const finish = (result) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			socket.close();
			resolve(result);
		};
		socket.onmessage = () => finish(true);
		socket.onerror = () => finish(false);
		socket.onclose = () => finish(false);
	});
}

// An ISOLATED test instance must never reach/adopt or kill the main instance — skip all three shared-stack guards.
if (!devInstanceIsolated && (await canReachExistingDevServer())) {
	const url = `http://${authority(webUiConnectHost, baseWebUiPort)}`;
	console.log(`nKlein dev server already running at ${url}`);
	await open(url);
	process.exit(0);
}

if (!devInstanceIsolated) {
	await stopStaleDevProcesses();
	await waitForPreferredDevPortsToSettle();
}

const runtimePort = await findPort(baseRuntimePort, new Set(), runtimeBindHost);
const webUiPort = await findPort(baseWebUiPort, new Set([runtimePort]), webUiBindHost);
const hasExplicitSkipCleanupArg = requestedRuntimeArgs.some((arg) => arg === "--skip-shutdown-cleanup");
const shouldDefaultSkipShutdownCleanup = !requestedDevFullArgs.includes(withShutdownCleanupFlag);
const runtimeCliArgs = [
	"--port",
	String(runtimePort),
	"--no-open",
	"--host",
	runtimeBindHost,
	...(runtimePublicHost && runtimePublicHost !== runtimeBindHost ? ["--public-host", runtimePublicHost] : []),
	...(shouldDefaultSkipShutdownCleanup && !hasExplicitSkipCleanupArg ? ["--skip-shutdown-cleanup"] : []),
	...requestedRuntimeArgs,
];

if (devInstanceIsolated) {
	console.log(`\n  🧪 ISOLATED TEST instance — data dir: ${process.env.HOME}/.nklein (separate from your main board)`);
}
console.log(`\n  Runtime port: ${runtimePort}`);
console.log(`  Web UI:       http://${authority(webUiConnectHost, webUiPort)}`);
if (webUiPublicHost !== webUiConnectHost) {
	console.log(`  LAN Web UI:   http://${authority(webUiPublicHost, webUiPort)}`);
}
console.log("");

const env = {
	NODE_ENV: "development",
	...process.env,
	NKLEIN_RUNTIME_PORT: String(runtimePort),
	KANBAN_RUNTIME_PORT: String(runtimePort),
	NKLEIN_WEB_UI_PORT: String(webUiPort),
	KANBAN_WEB_UI_PORT: String(webUiPort),
	NKLEIN_RUNTIME_HOST: runtimeBindHost,
	NKLEIN_RUNTIME_PUBLIC_HOST: runtimePublicHost,
	NKLEIN_RUNTIME_PROXY_HOST: runtimeConnectHost,
	NKLEIN_WEB_UI_HOST: webUiBindHost,
};

const tsxBin = isWindows ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx";
const runtime = spawn(tsxBin, ["src/cli.ts", ...runtimeCliArgs], {
	env,
	stdio: "inherit",
	// Detach the runtime from the terminal's process group on Unix so dev-full.mjs
	// owns signal handling and forwards one shutdown signal to the full process
	// tree. The runtime is intentionally not started through `tsx watch`; dev
	// mode must not restart active task sessions because a watched source file was
	// touched by an editor or formatter.
	...(isWindows ? {} : { detached: true }),
});

let vite;
let exiting = false;
let cleanupPromise = null;
let openBrowserTimeoutId = null;

function waitForChildExit(child, timeoutMs = 10000) {
	if (!child || child.exitCode !== null || child.killed) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			resolve();
		};
		child.once("exit", finish);
		setTimeout(finish, timeoutMs);
	});
}

async function cleanup(exitCode = 0) {
	if (cleanupPromise) {
		return await cleanupPromise;
	}
	cleanupPromise = (async () => {
		if (exiting) {
			return;
		}
		exiting = true;

		if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
			process.stdin.setRawMode(false);
		}
		if (openBrowserTimeoutId !== null) {
			clearTimeout(openBrowserTimeoutId);
			openBrowserTimeoutId = null;
		}

		const killPromises = [];
		if (vite?.pid) {
			killPromises.push(
				new Promise((resolve) => {
					treeKill(vite.pid, "SIGTERM", () => resolve(undefined));
				}),
			);
		}
		if (runtime.pid) {
			killPromises.push(
				new Promise((resolve) => {
					treeKill(runtime.pid, "SIGTERM", () => resolve(undefined));
				}),
			);
		}
		await Promise.allSettled(killPromises);
		await Promise.allSettled([waitForChildExit(vite), waitForChildExit(runtime)]);

		process.exitCode = exitCode;
		process.stdout.write("\n");
		process.exit(exitCode);
	})();
	return await cleanupPromise;
}

process.on("SIGTERM", () => {
	void cleanup(0);
});

let sigintCount = 0;
process.on("SIGINT", () => {
	sigintCount++;
	if (sigintCount >= 2) {
		process.stderr.write("\nForce stopping...\n");
		const forceKills = [];
		if (vite?.pid) forceKills.push(treeKillAsync(vite.pid, "SIGKILL"));
		if (runtime.pid) forceKills.push(treeKillAsync(runtime.pid, "SIGKILL"));
		void Promise.allSettled(forceKills).then(() => process.exit(1));
		return;
	}
	void cleanup(0);
});
runtime.on("exit", () => {
	void cleanup(1);
});

// Wait for runtime to accept connections before starting Vite
try {
	await waitForPort(runtimePort);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start runtime: ${message}`);
	await cleanup(1);
}

vite = spawn("npm", ["run", "web:dev"], {
	env,
	stdio: "inherit",
	shell: isWindows,
});

vite.on("exit", () => {
	void cleanup(1);
});

// Auto-open browser after a short delay for Vite to start
openBrowserTimeoutId = setTimeout(() => {
	open(`http://${authority(webUiConnectHost, webUiPort)}`);
}, 2000);
