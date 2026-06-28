import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

const requireFromHere = createRequire(import.meta.url);

function resolveShutdownIpcHookPath(): string {
	return resolve(process.cwd(), "test/integration/shutdown-ipc-hook.cjs");
}

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
	const checkout = spawnSync("git", ["checkout", "-B", "main"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (checkout.status !== 0) {
		throw new Error(`Failed to create main branch at ${path}`);
	}
}

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function commitAll(cwd: string, message: string): string {
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-qm", message]);
	return runGit(cwd, ["rev-parse", "HEAD"]);
}

async function getAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			resolveListen();
		});
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

async function waitForServerStart(process: ChildProcess, timeoutMs = 10_000): Promise<void> {
	await new Promise<void>((resolveStart, rejectStart) => {
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
			if (!stdout.includes("!Klein running at ") || settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			resolveStart();
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

function installBrowserOpenStub(binDir: string, logPath: string): void {
	mkdirSync(binDir, { recursive: true });
	const script = `#!/usr/bin/env sh
printf '%s\n' "$*" >> ${JSON.stringify(logPath)}
`;
	const commandNames = process.platform === "darwin" ? ["open"] : ["xdg-open"];
	for (const commandName of commandNames) {
		const scriptPath = join(binDir, commandName);
		writeFileSync(scriptPath, script, "utf8");
		chmodSync(scriptPath, 0o755);
	}
}

function readBrowserOpenLog(logPath: string): string[] {
	if (!existsSync(logPath)) {
		return [];
	}
	return readFileSync(logPath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

async function waitForBrowserOpenCount(logPath: string, expectedCount: number, timeoutMs = 2_000): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (readBrowserOpenLog(logPath).length >= expectedCount) {
			return;
		}
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 25);
		});
	}
	throw new Error(
		`Timed out waiting for browser open count ${expectedCount}. Current log: ${readBrowserOpenLog(logPath).join(", ")}`,
	);
}

async function waitForExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (process.exitCode !== null) {
		return true;
	}

	return await new Promise<boolean>((resolveExit) => {
		const handleExit = () => {
			clearTimeout(timeoutId);
			resolveExit(true);
		};
		const timeoutId = setTimeout(() => {
			process.removeListener("exit", handleExit);
			resolveExit(false);
		}, timeoutMs);
		process.once("exit", handleExit);
	});
}

async function requestGracefulShutdown(process: ChildProcess): Promise<void> {
	if (typeof process.send !== "function" || !process.connected) {
		process.kill("SIGINT");
		return;
	}

	await new Promise<void>((resolveSend) => {
		process.send?.({ type: "kanban.shutdown" }, () => {
			resolveSend();
		});
	});
}

function spawnSourceCli(
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: ChildProcess["stdio"] },
) {
	const cliEntrypoint = resolve(process.cwd(), "src/cli.ts");
	return spawn(process.execPath, ["--import", resolveTsxLoaderImportSpecifier(), cliEntrypoint, ...args], {
		cwd: options.cwd,
		// The CLI runs with cwd = a temp repo, so point tsx at this repo's tsconfig (cwd-relative discovery would miss
		// it) so the vendored-SDK `@nklein/*` path aliases resolve in the spawned process.
		env: { ...options.env, TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json") },
		stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
	});
}

async function runCliCommandAndCollectOutput(options: {
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; didExit: boolean }> {
	const process = spawnSourceCli(options.args, {
		cwd: options.cwd,
		env: options.env,
	});

	let stdout = "";
	let stderr = "";
	process.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	process.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});

	const didExit = await waitForExit(process, options.timeoutMs ?? 8_000);
	if (!didExit) {
		process.kill("SIGKILL");
	}

	return {
		stdout,
		stderr,
		exitCode: process.exitCode,
		didExit,
	};
}

describe("source task commands", () => {
	it("exits after creating a task when the runtime server is already running", { timeout: 60_000 }, async () => {
		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-task-exit-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-task-exit-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Task Exit Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					// Run the server from the neutral temp HOME, not the project: the self-improvement guard keys on the
					// server's own git root, so cwd=project would flag the project as !Klein's own source repo.
					cwd: homeDir,
					// tsx needs this repo's tsconfig (cwd is a temp dir) so the vendored `@nklein/*` aliases resolve.
					env: { ...env, TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json") },
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				const commandProcess = spawnSourceCli(
					[
						"task",
						"create",
						"--prompt",
						"Add a demo banner component to the homepage that displays a welcome message and current weather summary",
						"--project-path",
						projectPath,
					],
					{
						cwd: projectPath,
						env,
					},
				);

				let stdout = "";
				let stderr = "";
				commandProcess.stdout?.on("data", (chunk: Buffer) => {
					stdout += chunk.toString();
				});
				commandProcess.stderr?.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});

				const didExit = await waitForExit(commandProcess, 8_000);
				if (!didExit) {
					commandProcess.kill("SIGKILL");
				}

				expect(didExit, `task create did not exit in time.\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(true);
				expect(commandProcess.exitCode).toBe(0);
				expect(stdout).toContain('"ok": true');
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("opens only for launch invocations", { timeout: 60_000 }, async () => {
		if (process.platform === "win32") {
			return;
		}

		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-root-launch-open-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-root-launch-open-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Root Launch Browser Open Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const browserStubBinDir = join(homeDir, "browser-bin");
			const browserOpenLogPath = join(homeDir, "browser-open.log");
			installBrowserOpenStub(browserStubBinDir, browserOpenLogPath);
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
				PATH: `${browserStubBinDir}:${process.env.PATH ?? ""}`,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					// Server cwd is the neutral temp HOME. (The self-improvement guard no longer depends on this — it now
					// keys off !Klein's INSTALL location via projects-api `resolveKleinSourceRepoPath`, not the server cwd —
					// so cwd=project is also safe. This case stays red for a SEPARATE reason: `task list` is a read command
					// (autoCreateIfMissing:false) and nothing in the launch flow registers the project, so it reports
					// "Project … is not added yet". Fixing it needs a project registration step or a decision that a bare
					// launch-from-project auto-registers the project — see todo §5.U.)
					cwd: homeDir,
					// tsx needs this repo's tsconfig (cwd is a temp dir) so the vendored `@nklein/*` aliases resolve.
					env: { ...env, TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json") },
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				// Register the project first: `task list` below is a READ command (autoCreateIfMissing:false — reads must
				// not create projects) and a bare launch does not register a project, so without this it returns
				// "Project … is not added yet". A write command auto-adds it (and, being a subcommand, opens no browser),
				// matching the realistic flow where the project exists before you inspect it.
				const registerResult = await runCliCommandAndCollectOutput({
					args: ["task", "create", "--prompt", "Seed task to register the project", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(registerResult.exitCode).toBe(0);

				for (const [args, expectedOpenCount] of [
					[[], 1],
					[["task", "list", "--project-path", projectPath], 1],
					[["--agent", "codex"], 2],
					[["--port", port], 3],
				] as const) {
					const result = await runCliCommandAndCollectOutput({
						args: [...args],
						cwd: projectPath,
						env,
					});
					expect(result.didExit).toBe(true);
					expect(result.exitCode).toBe(0);
					await waitForBrowserOpenCount(browserOpenLogPath, expectedOpenCount);
					expect(readBrowserOpenLog(browserOpenLogPath)).toHaveLength(expectedOpenCount);
				}
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("supports separate completed and trash columns when moving and deleting tasks", { timeout: 60_000 }, async () => {
		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-task-done-delete-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-task-done-delete-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Task Done Delete Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					// Run the server from the neutral temp HOME, not the project: the self-improvement guard keys on the
					// server's own git root, so cwd=project would flag the project as !Klein's own source repo.
					cwd: homeDir,
					// tsx needs this repo's tsconfig (cwd is a temp dir) so the vendored `@nklein/*` aliases resolve.
					env: { ...env, TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json") },
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				const taskIds: string[] = [];
				for (const prompt of [
					"Create a temporary task for done and delete",
					"Create another temporary task for done and delete",
					"Create a legacy trash command task for done and delete",
				]) {
					const created = await runCliCommandAndCollectOutput({
						args: ["task", "create", "--prompt", prompt, "--project-path", projectPath],
						cwd: projectPath,
						env,
					});
					expect(
						created.didExit,
						`task create did not exit in time.\nstdout:\n${created.stdout}\nstderr:\n${created.stderr}`,
					).toBe(true);
					expect(created.exitCode).toBe(0);

					const createdPayload = JSON.parse(created.stdout) as {
						ok?: boolean;
						task?: { id?: string };
					};
					expect(createdPayload.ok).toBe(true);
					expect(typeof createdPayload.task?.id).toBe("string");
					if (createdPayload.task?.id) {
						taskIds.push(createdPayload.task.id);
					}
				}
				expect(taskIds).toHaveLength(3);

				const movedByDoneCommand = await runCliCommandAndCollectOutput({
					args: ["task", "done", "--task-id", taskIds[0] ?? "", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					movedByDoneCommand.didExit,
					`task done did not exit in time.\nstdout:\n${movedByDoneCommand.stdout}\nstderr:\n${movedByDoneCommand.stderr}`,
				).toBe(true);
				expect(movedByDoneCommand.exitCode).toBe(0);
				expect(movedByDoneCommand.stdout).toContain('"ok": true');
				expect(movedByDoneCommand.stdout).toContain('"column": "completed"');

				const movedByTrashCommand = await runCliCommandAndCollectOutput({
					args: ["task", "trash", "--column", "backlog", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					movedByTrashCommand.didExit,
					`task trash did not exit in time.\nstdout:\n${movedByTrashCommand.stdout}\nstderr:\n${movedByTrashCommand.stderr}`,
				).toBe(true);
				expect(movedByTrashCommand.exitCode).toBe(0);
				expect(movedByTrashCommand.stdout).toContain('"ok": true');
				expect(movedByTrashCommand.stdout).toContain('"column": "backlog"');
				expect(movedByTrashCommand.stdout).toContain('"count": 2');

				const listedDoneBeforeDelete = await runCliCommandAndCollectOutput({
					args: ["task", "list", "--column", "done", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					listedDoneBeforeDelete.didExit,
					`task list --column done did not exit in time.\nstdout:\n${listedDoneBeforeDelete.stdout}\nstderr:\n${listedDoneBeforeDelete.stderr}`,
				).toBe(true);
				expect(listedDoneBeforeDelete.exitCode).toBe(0);
				expect(listedDoneBeforeDelete.stdout).toContain('"count": 1');

				const listedTrashBeforeDelete = await runCliCommandAndCollectOutput({
					args: ["task", "list", "--column", "trash", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					listedTrashBeforeDelete.didExit,
					`task list --column trash did not exit in time.\nstdout:\n${listedTrashBeforeDelete.stdout}\nstderr:\n${listedTrashBeforeDelete.stderr}`,
				).toBe(true);
				expect(listedTrashBeforeDelete.exitCode).toBe(0);
				expect(listedTrashBeforeDelete.stdout).toContain('"count": 2');

				const deletedDone = await runCliCommandAndCollectOutput({
					args: ["task", "delete", "--column", "done", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					deletedDone.didExit,
					`task delete --column done did not exit in time.\nstdout:\n${deletedDone.stdout}\nstderr:\n${deletedDone.stderr}`,
				).toBe(true);
				expect(deletedDone.exitCode).toBe(0);
				expect(deletedDone.stdout).toContain('"ok": true');
				expect(deletedDone.stdout).toContain('"column": "completed"');
				expect(deletedDone.stdout).toContain('"count": 1');

				const deletedTrash = await runCliCommandAndCollectOutput({
					args: ["task", "delete", "--column", "trash", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					deletedTrash.didExit,
					`task delete --column trash did not exit in time.\nstdout:\n${deletedTrash.stdout}\nstderr:\n${deletedTrash.stderr}`,
				).toBe(true);
				expect(deletedTrash.exitCode).toBe(0);
				expect(deletedTrash.stdout).toContain('"ok": true');
				expect(deletedTrash.stdout).toContain('"column": "trash"');
				expect(deletedTrash.stdout).toContain('"count": 2');

				const listedTrash = await runCliCommandAndCollectOutput({
					args: ["task", "list", "--column", "trash", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					listedTrash.didExit,
					`task list --column trash did not exit in time.\nstdout:\n${listedTrash.stdout}\nstderr:\n${listedTrash.stderr}`,
				).toBe(true);
				expect(listedTrash.exitCode).toBe(0);
				expect(listedTrash.stdout).toContain('"count": 0');
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("treats create-time reasoning inherit as no explicit override", { timeout: 60_000 }, async () => {
		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-task-nklein-reasoning-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-task-nklein-reasoning-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Task NKlein Reasoning Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					// Run the server from the neutral temp HOME, not the project: the self-improvement guard keys on the
					// server's own git root, so cwd=project would flag the project as !Klein's own source repo.
					cwd: homeDir,
					// tsx needs this repo's tsconfig (cwd is a temp dir) so the vendored `@nklein/*` aliases resolve.
					env: { ...env, TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json") },
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				const inheritedCreate = await runCliCommandAndCollectOutput({
					args: [
						"task",
						"create",
						"--prompt",
						"Create a task that inherits workspace reasoning",
						"--project-path",
						projectPath,
						"--nklein-reasoning-effort",
						"inherit",
					],
					cwd: projectPath,
					env,
				});
				expect(inheritedCreate.didExit).toBe(true);
				expect(inheritedCreate.exitCode).toBe(0);

				const inheritedPayload = JSON.parse(inheritedCreate.stdout) as {
					ok?: boolean;
					task?: { nkleinSettings?: Record<string, unknown> };
				};
				expect(inheritedPayload.ok).toBe(true);
				expect(inheritedPayload.task?.nkleinSettings).toBeUndefined();

				const defaultCreate = await runCliCommandAndCollectOutput({
					args: [
						"task",
						"create",
						"--prompt",
						"Create a task that uses model default reasoning",
						"--project-path",
						projectPath,
						"--nklein-reasoning-effort",
						"default",
					],
					cwd: projectPath,
					env,
				});
				expect(defaultCreate.didExit).toBe(true);
				expect(defaultCreate.exitCode).toBe(0);

				const defaultPayload = JSON.parse(defaultCreate.stdout) as {
					ok?: boolean;
					task?: { nkleinSettings?: Record<string, unknown> };
				};
				expect(defaultPayload.ok).toBe(true);
				expect(defaultPayload.task?.nkleinSettings).toEqual({});
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});
});
