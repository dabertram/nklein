import type { execFile } from "node:child_process";
import type { AgentToolContext } from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import {
	AGENT_SANDBOX_CONTAINER_LABEL,
	AGENT_SANDBOX_VOLUME_PREFIX,
	AgentSandboxManager,
	AgentSandboxUnavailableError,
	buildAgentSandboxDockerRunArgs,
	createAgentSandboxTaskUid,
	createAgentSandboxToolExecutors,
	DEFAULT_AGENT_SANDBOX_IMAGE,
	normalizeAgentSandboxPoolConfig,
} from "../../../src/cline-sdk/cline-agent-sandbox";
import { ClinePauseController } from "../../../src/cline-sdk/cline-pause-controller";

interface ExecFileStubOptions {
	failVersion?: boolean;
	failImageInspect?: boolean;
	psOutput?: string;
	volumeLsOutput?: string;
	execStdout?: string;
}

function createExecFileStub(options?: ExecFileStubOptions): {
	execFile: typeof execFile;
	calls: string[][];
} {
	const calls: string[][] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push([...args]);
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (options?.failVersion && args[0] === "version") {
			done(Object.assign(new Error("docker missing"), { code: 127, stdout: "", stderr: "command not found" }));
			return {} as ReturnType<typeof execFile>;
		}
		if (options?.failImageInspect && args.join(" ") === "image inspect test-image") {
			done(Object.assign(new Error("missing image"), { code: 1, stdout: "", stderr: "No such image" }));
			return {} as ReturnType<typeof execFile>;
		}
		let stdout = "";
		if (args.join(" ") === `ps -aq --filter label=${AGENT_SANDBOX_CONTAINER_LABEL}`) {
			stdout = options?.psOutput ?? "";
		} else if (args.join(" ") === `volume ls -q --filter name=${AGENT_SANDBOX_VOLUME_PREFIX}`) {
			stdout = options?.volumeLsOutput ?? "";
		} else if (args[0] === "run") {
			stdout = "container-id\n";
		} else if (args[0] === "exec") {
			stdout = options?.execStdout ?? "";
		}
		done(null, { stdout, stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return {
		execFile: stub as unknown as typeof execFile,
		calls,
	};
}

function createDelayedRunExecFileStub(): {
	execFile: typeof execFile;
	calls: string[][];
	finishRun: () => void;
} {
	const calls: string[][] = [];
	let runCallback: ((error: unknown, result?: { stdout: string; stderr: string }) => void) | null = null;
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push([...args]);
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (args[0] === "run") {
			runCallback = done;
			return {} as ReturnType<typeof execFile>;
		}
		done(null, { stdout: "", stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return {
		execFile: stub as unknown as typeof execFile,
		calls,
		finishRun: () => {
			runCallback?.(null, { stdout: "container-id\n", stderr: "" });
			runCallback = null;
		},
	};
}

describe("AgentSandboxManager", () => {
	it("uses a pinned default sandbox image tag", () => {
		expect(DEFAULT_AGENT_SANDBOX_IMAGE).not.toMatch(/:latest$/);
		expect(DEFAULT_AGENT_SANDBOX_IMAGE).toMatch(/:\d+\.\d+\.\d+$/);
	});

	it("builds a locked-down docker run command", () => {
		const args = buildAgentSandboxDockerRunArgs({
			slot: 1,
			image: "test-image",
			projectMounts: [{ projectKey: "abc123", projectRepoPath: "/repo" }],
			config: normalizeAgentSandboxPoolConfig({
				maxContainers: 1,
				agentsPerContainer: 2,
				memoryPerContainerMb: 2048,
				cpusPerContainer: 1.5,
			}),
		});

		expect(args).toContain("--network");
		expect(args).toContain("none");
		expect(args).toContain("--cap-drop");
		expect(args).toContain("ALL");
		expect(args).toContain("--security-opt");
		expect(args).toContain("no-new-privileges");
		expect(args).toContain("--read-only");
		expect(args).toContain("--tmpfs");
		expect(args).toContain("/tmp:noexec,nosuid,size=512m");
		expect(args).toContain("--memory");
		expect(args).toContain("2048m");
		expect(args).toContain("--cpus");
		expect(args).toContain("1.5");
		expect(args).toContain("--pids-limit");
		expect(args).toContain("512");
		expect(args).toContain("type=volume,src=nklein-agent-ws-1,dst=/workspaces");
		expect(args).toContain("type=bind,src=/repo,dst=/repos/abc123,readonly");
		expect(args.slice(-3)).toEqual(["test-image", "sleep", "infinity"]);
	});

	it("fails closed when docker is unavailable", async () => {
		const { execFile: execFileStub } = createExecFileStub({ failVersion: true });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await expect(manager.assertAvailable()).rejects.toBeInstanceOf(AgentSandboxUnavailableError);
	});

	it("fails closed when the sandbox image is missing", async () => {
		const { execFile: execFileStub } = createExecFileStub({ failImageInspect: true });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await expect(manager.assertAvailable()).rejects.toThrow("sandbox image test-image is unavailable");
	});

	it("reports structured sandbox availability status", async () => {
		const { execFile: execFileStub } = createExecFileStub({ failImageInspect: true });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await expect(manager.checkAvailability(() => 123)).resolves.toEqual({
			state: "blocked",
			dockerAvailable: true,
			imageAvailable: false,
			image: "test-image",
			message: "Docker agent sandbox image test-image is unavailable. Run npm run sandbox:build, then retry.",
			checkedAt: 123,
		});
	});

	it("reaps orphan containers and workspace volumes by label and generated-name prefix", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub({
			psOutput: "container-a\ncontainer-b\n",
			volumeLsOutput: "nklein-agent-ws-1\nother-volume\nnklein-agent-ws-backup\nnklein-agent-ws-2\n",
		});
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await manager.reapOrphanResources();

		expect(calls).toContainEqual(["ps", "-aq", "--filter", `label=${AGENT_SANDBOX_CONTAINER_LABEL}`]);
		expect(calls).toContainEqual(["rm", "-f", "container-a"]);
		expect(calls).toContainEqual(["rm", "-f", "container-b"]);
		expect(calls).toContainEqual(["volume", "ls", "-q", "--filter", `name=${AGENT_SANDBOX_VOLUME_PREFIX}`]);
		expect(calls).toContainEqual(["volume", "rm", "nklein-agent-ws-1"]);
		expect(calls).toContainEqual(["volume", "rm", "nklein-agent-ws-2"]);
		expect(calls).not.toContainEqual(["volume", "rm", "other-volume"]);
		expect(calls).not.toContainEqual(["volume", "rm", "nklein-agent-ws-backup"]);
	});

	it("queues tasks when the pool is full and reuses the freed container", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 1,
				agentsPerContainer: 1,
				idleTimeoutMs: 0,
			},
		});

		const first = await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		const queued = manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		let queuedResolved = false;
		void queued.then(() => {
			queuedResolved = true;
		});
		await Promise.resolve();

		expect(first.slot).toBe(1);
		expect(queuedResolved).toBe(false);

		await manager.disposeWorkspace("task-1");
		const second = await queued;

		expect(second.slot).toBe(1);
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
	});

	it("does not over-assign a freed slot while draining multiple queued tasks", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 1,
				agentsPerContainer: 1,
				idleTimeoutMs: 0,
			},
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		const secondQueued = manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		const thirdQueued = manager.acquireSlot({ taskId: "task-3", projectRepoPath: "/repo" });
		let thirdResolved = false;
		void thirdQueued.then(() => {
			thirdResolved = true;
		});
		await Promise.resolve();

		await manager.disposeWorkspace("task-1");
		await expect(secondQueued).resolves.toMatchObject({ taskId: "task-2", slot: 1 });
		await Promise.resolve();

		expect(thirdResolved).toBe(false);

		await manager.disposeWorkspace("task-2");
		await expect(thirdQueued).resolves.toMatchObject({ taskId: "task-3", slot: 1 });
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
	});

	it("does not arm idle teardown while a queued task takes the freed slot", async () => {
		vi.useFakeTimers();
		try {
			const { execFile: execFileStub, calls } = createExecFileStub();
			const manager = new AgentSandboxManager({
				image: "test-image",
				execFile: execFileStub,
				poolConfig: {
					maxContainers: 1,
					agentsPerContainer: 1,
					idleTimeoutMs: 100,
				},
			});

			await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
			const queued = manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
			await Promise.resolve();

			await manager.disposeWorkspace("task-1");
			await expect(queued).resolves.toMatchObject({ taskId: "task-2", slot: 1 });
			await vi.advanceTimersByTimeAsync(101);

			const containerRmCallCountBeforeFinalRelease = calls.filter(
				(args) => args.join(" ") === "rm -f nklein-agent-sandbox-1",
			).length;
			expect(containerRmCallCountBeforeFinalRelease).toBe(1);

			await manager.disposeWorkspace("task-2");
			await vi.advanceTimersByTimeAsync(101);

			expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1")).toHaveLength(
				containerRmCallCountBeforeFinalRelease + 1,
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("starts each container slot with a single in-flight docker run", async () => {
		const { execFile: execFileStub, calls, finishRun } = createDelayedRunExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 1,
				agentsPerContainer: 0,
				idleTimeoutMs: 0,
			},
		});

		const first = manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		const second = manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });

		await vi.waitFor(() => {
			expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
		});

		finishRun();

		await expect(Promise.all([first, second])).resolves.toEqual([
			expect.objectContaining({ slot: 1 }),
			expect.objectContaining({ slot: 1 }),
		]);
	});

	it("cancels idle teardown when a new task reuses the container", async () => {
		vi.useFakeTimers();
		try {
			const { execFile: execFileStub, calls } = createExecFileStub();
			const manager = new AgentSandboxManager({
				image: "test-image",
				execFile: execFileStub,
				poolConfig: {
					maxContainers: 1,
					agentsPerContainer: 1,
					idleTimeoutMs: 100,
				},
			});

			await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
			await manager.disposeWorkspace("task-1");
			const containerRmCallCountBeforeReuse = calls.filter(
				(args) => args.join(" ") === "rm -f nklein-agent-sandbox-1",
			).length;
			await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
			await vi.advanceTimersByTimeAsync(101);

			expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1")).toHaveLength(
				containerRmCallCountBeforeReuse,
			);

			await manager.disposeWorkspace("task-2");
			await vi.advanceTimersByTimeAsync(101);

			expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1")).toHaveLength(
				containerRmCallCountBeforeReuse + 1,
			);
			expect(calls).toContainEqual(["volume", "rm", "nklein-agent-ws-1"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("assigns stable unprivileged task uids", () => {
		const first = createAgentSandboxTaskUid("task-1");
		const second = createAgentSandboxTaskUid("task-1");
		const otherTask = createAgentSandboxTaskUid("task-2");

		expect(first).toBe(second);
		expect(first).not.toBe(otherTask);
		expect(first).toBeGreaterThanOrEqual(70_000);
		expect(first).toBeLessThan(90_000);
	});

	it("serializes tool-runner input and parses JSON results", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub({
			execStdout: JSON.stringify({ ok: true, result: "edited" }),
		});
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await expect(manager.runTool("task-1", "editor", { command: "replace" })).resolves.toBe("edited");
		expect(calls).toContainEqual([
			"exec",
			"-u",
			String(createAgentSandboxTaskUid("task-1")),
			"-w",
			"/workspaces/task-1",
			"nklein-agent-sandbox-1",
			"node",
			"/opt/nklein/tool-runner.mjs",
			"editor",
			JSON.stringify({ command: "replace" }),
		]);
	});

	it("queues tool execution while the task is paused", async () => {
		const pauseController = new ClinePauseController();
		pauseController.setCardPaused("task-1", true);
		const runTool = vi.fn(async () => "ok");
		const executors = createAgentSandboxToolExecutors({ runTool } as unknown as AgentSandboxManager, "task-1", {
			pauseController,
		});
		const bash = executors.bash;
		if (!bash) {
			throw new Error("Expected sandbox bash executor.");
		}

		const pending = bash("npm test", "/workspace", {} as AgentToolContext);
		await Promise.resolve();

		expect(runTool).not.toHaveBeenCalled();

		pauseController.setCardPaused("task-1", false);

		await expect(pending).resolves.toBe("ok");
		expect(runTool).toHaveBeenCalledWith("task-1", "bash", "npm test");
	});

	it("disables web fetch without falling back to host networking", async () => {
		const runTool = vi.fn(async () => "unexpected");
		const executors = createAgentSandboxToolExecutors({ runTool } as unknown as AgentSandboxManager, "task-1");
		const webFetch = executors.webFetch;
		if (!webFetch) {
			throw new Error("Expected sandbox webFetch executor.");
		}

		await expect(webFetch("https://example.com", "/workspace", {} as AgentToolContext)).resolves.toContain(
			"no-network Docker sandbox",
		);
		expect(runTool).not.toHaveBeenCalled();
	});

	it("rejects queued tool execution when the task wait is aborted", async () => {
		const pauseController = new ClinePauseController();
		pauseController.setCardPaused("task-1", true);
		const runTool = vi.fn(async () => "ok");
		const executors = createAgentSandboxToolExecutors({ runTool } as unknown as AgentSandboxManager, "task-1", {
			pauseController,
		});
		const bash = executors.bash;
		if (!bash) {
			throw new Error("Expected sandbox bash executor.");
		}

		const pending = bash("npm test", "/workspace", {} as AgentToolContext);
		await Promise.resolve();

		pauseController.abortTaskWaiters("task-1");

		await expect(pending).rejects.toThrow("Task pause wait was aborted.");
		expect(runTool).not.toHaveBeenCalled();
	});
});
