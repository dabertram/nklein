import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createGitTestEnv } from "../../utilities/git-env";

const requireFromHere = createRequire(import.meta.url);

export interface BackendUnderTest {
	baseUrl: string;
	stop: () => Promise<void>;
}

export interface BackendStartOptions {
	cwd: string;
	homeDir: string;
	port?: number;
	extraArgs?: string[];
	/** Extra env vars merged into the spawned server's environment (e.g. NODE_ENV=development for dev-only procedures). */
	extraEnv?: Record<string, string>;
	/** Receive the spawned server's stdout/stderr AFTER startup (e.g. to surface runtime warnings in e2e harnesses). */
	onLog?: (chunk: string, source: "stdout" | "stderr") => void;
}

export type BackendFactory = (options: BackendStartOptions) => Promise<BackendUnderTest>;

export async function getAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => resolveListen());
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : null;
	await new Promise<void>((resolveClose, rejectClose) => {
		server.close((error) => {
			if (error) {
				rejectClose(error);
				return;
			}
			resolveClose();
		});
	});
	if (!port) {
		throw new Error("Could not allocate a test port.");
	}
	return port;
}

function resolveShutdownIpcHookPath(): string {
	return resolve(process.cwd(), "test/integration/shutdown-ipc-hook.cjs");
}

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

async function waitForProcessStart(process: ChildProcess, timeoutMs = 10_000): Promise<{ runtimeUrl: string }> {
	return await new Promise((resolveStart, rejectStart) => {
		if (!process.stdout || !process.stderr) {
			rejectStart(new Error("Expected child process stdout/stderr pipes to be available."));
			return;
		}
		let settled = false;
		let stdout = "";
		let stderr = "";
		const timeoutId = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			rejectStart(new Error(`Timed out waiting for server start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
		}, timeoutMs);
		const handleOutput = (chunk: Buffer, source: "stdout" | "stderr") => {
			const text = chunk.toString();
			if (source === "stdout") {
				stdout += text;
			} else {
				stderr += text;
			}
			const match = stdout.match(/!Klein running at (http:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/);
			if (!match || settled) {
				return;
			}
			const runtimeUrl = match[1];
			if (!runtimeUrl) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			resolveStart({ runtimeUrl });
		};
		process.stdout.on("data", (chunk: Buffer) => {
			handleOutput(chunk, "stdout");
		});
		process.stderr.on("data", (chunk: Buffer) => {
			handleOutput(chunk, "stderr");
		});
		process.once("exit", (code, signal) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			rejectStart(
				new Error(
					`Server process exited before startup (code=${String(code)} signal=${String(signal)}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
				),
			);
		});
	});
}

function getShutdownSignal(): NodeJS.Signals {
	return process.platform === "win32" ? "SIGTERM" : "SIGINT";
}

async function requestGracefulShutdown(childProcess: ChildProcess): Promise<void> {
	if (typeof childProcess.send !== "function" || !childProcess.connected) {
		childProcess.kill(getShutdownSignal());
		return;
	}

	await new Promise<void>((resolveSend) => {
		childProcess.send({ type: "kanban.shutdown" }, (error) => {
			if (error) {
				childProcess.kill(getShutdownSignal());
			}
			resolveSend();
		});
	});
}

async function waitForExit(childProcess: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (childProcess.exitCode !== null) {
		return true;
	}

	return await new Promise<boolean>((resolveExit) => {
		const handleExit = () => {
			clearTimeout(timeoutId);
			resolveExit(true);
		};
		const timeoutId = setTimeout(() => {
			childProcess.removeListener("exit", handleExit);
			resolveExit(false);
		}, timeoutMs);
		childProcess.once("exit", handleExit);
	});
}

export const startTsBackend: BackendFactory = async (options: BackendStartOptions): Promise<BackendUnderTest> => {
	const port = options.port ?? (await getAvailablePort());
	const cliEntrypoint = resolve(process.cwd(), "src/cli.ts");
	const shutdownIpcHookPath = resolveShutdownIpcHookPath();
	const tsxLoaderImportSpecifier = resolveTsxLoaderImportSpecifier();
	const child = spawn(
		process.execPath,
		[
			"--require",
			shutdownIpcHookPath,
			"--import",
			tsxLoaderImportSpecifier,
			cliEntrypoint,
			"--no-open",
			...(options.extraArgs ?? []),
		],
		{
			cwd: options.cwd,
			env: {
				...createGitTestEnv({
					HOME: options.homeDir,
					USERPROFILE: options.homeDir,
					KANBAN_RUNTIME_PORT: String(port),
				}),
				// tsx resolves tsconfig paths from process.cwd(), but the spawned
				// server's cwd is a temp project dir, not the repo root. Pin the
				// tsconfig so @nklein/* path aliases resolve correctly at runtime.
				TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json"),
				// Keep the contract/integration tests hermetic: don't auto-start the real core-py Python sidecar
				// (todo §5.H) — these tests exercise the TS backend's HTTP behavior; the sidecar + its auto-start are
				// covered separately (Suite 11 + klein-core-sidecar.test.ts). Avoids a uv/Python dependency + a stray
				// process per spawned server.
				NKLEIN_CORE_PY: "0",
				...(options.extraEnv ?? {}),
			},
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		},
	);
	const { runtimeUrl } = await waitForProcessStart(child);
	if (options.onLog) {
		const { onLog } = options;
		child.stdout?.on("data", (chunk: Buffer) => onLog(chunk.toString(), "stdout"));
		child.stderr?.on("data", (chunk: Buffer) => onLog(chunk.toString(), "stderr"));
	}
	return {
		baseUrl: runtimeUrl,
		stop: async () => {
			if (child.exitCode !== null) {
				return;
			}
			await requestGracefulShutdown(child);
			const didExitGracefully = await waitForExit(child, 5_000);
			if (didExitGracefully) {
				return;
			}

			child.kill("SIGKILL");
			const didExitAfterForce = await waitForExit(child, 5_000);
			if (!didExitAfterForce) {
				throw new Error("Timed out stopping kanban test server process.");
			}
		},
	};
};

export function resolveBackendFactory(): BackendFactory {
	const backendUnderTest = process.env.BACKEND_UNDER_TEST ?? "ts";
	if (backendUnderTest === "ts") {
		return startTsBackend;
	}
	if (backendUnderTest === "python") {
		throw new Error("Python backend is not yet implemented. Set BACKEND_UNDER_TEST=ts or leave unset.");
	}
	throw new Error(
		`Unknown BACKEND_UNDER_TEST value: "${backendUnderTest}". Supported values: "ts". (Python backend is not yet implemented.)`,
	);
}
