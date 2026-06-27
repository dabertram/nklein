/**
 * Reusable FULL-SYSTEM e2e harness (2026-06-28). Boots the REAL !Klein runtime server — the same `src/cli.ts` entry
 * `dev:full` launches — under an isolated HOME on a free port, and hands back a typed tRPC client so a verifier can
 * drive the genuine stack (tRPC + WS hub + runtime-state-hub + scheduler + Docker sandbox + live model), not mocks.
 *
 * This is the substrate for the full-system layer: `verify-full-system.mts` (verify a small scaffolded project's
 * generated result is actually valid) builds on it, and future full-system verifiers (project-switch stall, evidence,
 * review→merge) should reuse `bootFullSystemRuntime` instead of re-spawning the server by hand.
 *
 * Mocked, deterministic UI behavior is the SEPARATE Playwright `web-ui/tests/harness/runtime-mock.ts` layer; this module
 * is the opposite end — the real backend producing a real, checkable artifact.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import treeKill from "tree-kill";
import type { RuntimeAppRouter } from "../src/trpc/app-router";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type FullSystemTrpcClient = ReturnType<typeof createTRPCProxyClient<RuntimeAppRouter>>;

export interface BootFullSystemRuntimeOptions {
	/** Isolated HOME the runtime reads its config/locks/state from. Defaults to `process.env.HOME` (which must be isolated). */
	home?: string;
	/** Preferred runtime port; the harness finds the next free port at/above it. Default 3499 (off dev:full's 3484). */
	preferredPort?: number;
	/** Milliseconds to wait for the server to accept connections. Default 30000. */
	readyTimeoutMs?: number;
	/** Mirror the child's stdout/stderr to this process (default false — captured for diagnostics only). */
	inheritStdio?: boolean;
}

export interface FullSystemRuntime {
	readonly port: number;
	readonly baseUrl: string;
	readonly wsBaseUrl: string;
	readonly home: string;
	/** Global (unscoped) tRPC client — use for `projects.*`, `runtime.getConfig`, model pinning, etc. */
	readonly trpc: FullSystemTrpcClient;
	/** A tRPC client scoped to a workspace (sends the `x-nklein-workspace-id` header) — use for `workspace.*`, task starts. */
	workspaceClient(workspaceId: string): FullSystemTrpcClient;
	/** Open a board WebSocket for a workspace (the snapshot + task_chat_message stream). */
	openBoardSocket(workspaceId: string): WebSocket;
	/** Recent captured stderr (diagnostics when a boot/run fails). */
	stderrTail(): string;
	/** Gracefully stop the runtime (SIGTERM → SIGKILL fallback) so its sandbox containers clean up. */
	stop(): Promise<void>;
}

/** Refuse to boot a full-system runtime against the developer's real HOME (it writes config/state/locks). */
export function assertIsolatedHome(home = homedir()): void {
	if (process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME === "1") {
		return;
	}
	if (!home.includes("nklein-verify") && !home.includes("nklein-full-system")) {
		throw new Error(
			`Refusing to boot a full-system runtime against HOME=${home}. Set HOME to an isolated dir ` +
				"(e.g. /tmp/nklein-full-system) or NKLEIN_VERIFY_ALLOW_REAL_HOME=1 to override.",
		);
	}
}

function findFreePort(start: number): Promise<number> {
	return new Promise((resolvePort) => {
		const server = createServer();
		server.once("error", () => resolvePort(findFreePort(start + 1)));
		server.listen(start, "127.0.0.1", () => {
			server.close(() => resolvePort(start));
		});
	});
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolvePort, reject) => {
		const attempt = (): void => {
			const socket = connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.destroy();
				resolvePort();
			});
			socket.once("error", () => {
				socket.destroy();
				if (Date.now() > deadline) {
					reject(new Error(`Runtime did not accept connections on :${port} within ${timeoutMs}ms`));
				} else {
					setTimeout(attempt, 200);
				}
			});
		};
		attempt();
	});
}

function treeKillAsync(pid: number, signal: NodeJS.Signals): Promise<void> {
	return new Promise((resolveKill) => treeKill(pid, signal, () => resolveKill()));
}

/**
 * Boot the real runtime server (`tsx src/cli.ts --port <p> --no-open`) under the given isolated HOME with
 * `NODE_ENV=development` (required so the dev-test-project tRPC endpoints are enabled), and wait until it accepts
 * connections. Returns a handle with typed tRPC clients + a clean `stop()`.
 */
export async function bootFullSystemRuntime(options: BootFullSystemRuntimeOptions = {}): Promise<FullSystemRuntime> {
	const home = options.home ?? process.env.HOME ?? homedir();
	assertIsolatedHome(home);
	const port = await findFreePort(options.preferredPort ?? 3499);
	const baseUrl = `http://127.0.0.1:${port}`;
	const wsBaseUrl = `ws://127.0.0.1:${port}`;

	const tsxBin = resolve(REPO_ROOT, "node_modules/.bin/tsx");
	const child: ChildProcess = spawn(
		tsxBin,
		["src/cli.ts", "--port", String(port), "--no-open"],
		{
			cwd: REPO_ROOT,
			env: {
				...process.env,
				NODE_ENV: "development",
				HOME: home,
				USERPROFILE: home,
				KANBAN_RUNTIME_PORT: String(port),
			},
			stdio: options.inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
		},
	);

	const stderrChunks: string[] = [];
	const captureStderr = (chunk: Buffer): void => {
		stderrChunks.push(chunk.toString());
		if (stderrChunks.length > 200) {
			stderrChunks.splice(0, stderrChunks.length - 200);
		}
	};
	child.stdout?.on("data", () => {
		/* drained so the pipe never blocks; readiness is detected via the port */
	});
	child.stderr?.on("data", captureStderr);

	let childExited = false;
	child.once("exit", () => {
		childExited = true;
	});

	const stderrTail = (): string => stderrChunks.join("").split("\n").slice(-40).join("\n");

	try {
		await waitForPort(port, options.readyTimeoutMs ?? 30_000);
	} catch (error) {
		if (child.pid && !childExited) {
			await treeKillAsync(child.pid, "SIGKILL").catch(() => undefined);
		}
		const tail = stderrTail();
		throw new Error(`${error instanceof Error ? error.message : String(error)}${tail ? `\n--- runtime stderr ---\n${tail}` : ""}`);
	}

	const makeClient = (workspaceId?: string): FullSystemTrpcClient =>
		createTRPCProxyClient<RuntimeAppRouter>({
			links: [
				httpBatchLink({
					url: `${baseUrl}/api/trpc`,
					headers: () => (workspaceId ? { "x-nklein-workspace-id": workspaceId } : {}),
				}),
			],
		});

	return {
		port,
		baseUrl,
		wsBaseUrl,
		home,
		trpc: makeClient(),
		workspaceClient: (workspaceId: string) => makeClient(workspaceId),
		openBoardSocket: (workspaceId: string) =>
			new WebSocket(`${wsBaseUrl}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`),
		stderrTail,
		async stop(): Promise<void> {
			if (!child.pid || childExited) {
				return;
			}
			await treeKillAsync(child.pid, "SIGTERM").catch(() => undefined);
			const deadline = Date.now() + 10_000;
			while (!childExited && Date.now() < deadline) {
				await new Promise((settle) => setTimeout(settle, 100));
			}
			if (!childExited && child.pid) {
				await treeKillAsync(child.pid, "SIGKILL").catch(() => undefined);
			}
		},
	};
}
