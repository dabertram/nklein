import type { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createHomeAgentSessionId } from "../../../src/core/home-agent-session";
import {
	AGENT_SANDBOX_CONTAINER_LABEL,
	AGENT_SANDBOX_VOLUME_PREFIX,
	AgentSandboxExecutionError,
	AgentSandboxManager,
	AgentSandboxUnavailableError,
	buildAgentSandboxDockerRunArgs,
	buildAgentSandboxInteractiveShellArgs,
	buildAgentSandboxWorkdir,
	buildTaskShellSpawnSpec,
	createAgentSandboxProjectKey,
	createAgentSandboxTaskUid,
	createAgentSandboxToolExecutors,
	DEFAULT_AGENT_SANDBOX_IMAGE,
	DEFAULT_AGENT_SANDBOX_SHELL,
	normalizeAgentSandboxPoolConfig,
	resolveAgentSandboxNetworkArgs,
	resolveNKleinAgentPerceivedCwd,
} from "../../../src/nklein-agent/nklein-agent-sandbox";
import { NKleinPauseController } from "../../../src/nklein-agent/nklein-pause-controller";
import type { AgentToolContext } from "../../../src/nklein-agent/sdk-agent-types";
import { resolveNKleinSdkSystemPrompt } from "../../../src/nklein-agent/sdk-runtime-boundary";

interface ExecFileStubOptions {
	failVersion?: boolean;
	failImageInspect?: boolean;
	psOutput?: string;
	volumeLsOutput?: string;
	execStdout?: string;
	failExecCommand?: readonly string[];
	/**
	 * Controls the DEAD-CONTAINER liveness probe (`docker inspect -f {{.State.Running}} <name>`). When set, the
	 * function is asked once per inspect call (in order) and returns the running-state string to emit on stdout
	 * ("true" = alive, "false"/"" = dead), or the literal `"THROW"` to simulate a docker daemon error (non-zero
	 * exit with a connection-refused stderr — the ambiguous, keep-the-container path). Defaults to "true".
	 */
	inspectRunningState?: (callIndex: number) => string;
}

function createExecFileStub(options?: ExecFileStubOptions): {
	execFile: typeof execFile;
	calls: string[][];
} {
	const calls: string[][] = [];
	let inspectCallIndex = 0;
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
		// DEAD-CONTAINER liveness probe: `docker inspect -f {{.State.Running}} <name>`.
		if (args[0] === "inspect" && args[1] === "-f" && args[2] === "{{.State.Running}}") {
			const state = options?.inspectRunningState?.(inspectCallIndex++) ?? "true";
			if (state === "THROW") {
				// Simulate a docker daemon failure (non-zero exit, no running-state) — the ambiguous path where the
				// container must be KEPT, not torn out.
				done(
					Object.assign(new Error("daemon down"), {
						code: 1,
						stdout: "",
						stderr: "Cannot connect to the Docker daemon",
					}),
				);
				return {} as ReturnType<typeof execFile>;
			}
			if (state === "MISSING") {
				// Simulate "No such container" — inspect exits non-zero, container is genuinely gone.
				done(
					Object.assign(new Error("no such container"), {
						code: 1,
						stdout: "",
						stderr: "Error: No such object: nklein-agent-sandbox-1",
					}),
				);
				return {} as ReturnType<typeof execFile>;
			}
			done(null, { stdout: `${state}\n`, stderr: "" });
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
			const command = args.slice(6);
			if (options?.failExecCommand && command.join("\0") === options.failExecCommand.join("\0")) {
				done(Object.assign(new Error("exec failed"), { code: 1, stdout: "", stderr: "sandbox failure" }));
				return {} as ReturnType<typeof execFile>;
			}
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

/**
 * Stub that HOLDS the dead-container liveness probe (`docker inspect -f {{.State.Running}} <name>`) until released,
 * so a test can observe how many probes are in flight while two concurrent reuses are pending. `run` completes
 * immediately (returns a container id); every other command is a no-op. This is the barrier that makes the
 * single-flight race guard observable: the FIXED code issues ONE probe (the 2nd concurrent reuser awaits the shared
 * `starting` promise), while the pre-fix probe-before-guard code would issue TWO (one per caller).
 */
function createProbeBarrierExecFileStub(): {
	execFile: typeof execFile;
	calls: string[][];
	releaseProbe: (state: string) => void;
	pendingProbes: () => number;
} {
	const calls: string[][] = [];
	const probeCallbacks: ((error: unknown, result?: { stdout: string; stderr: string }) => void)[] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push([...args]);
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (args[0] === "inspect" && args[1] === "-f" && args[2] === "{{.State.Running}}") {
			probeCallbacks.push(done); // HOLD the probe until releaseProbe().
			return {} as ReturnType<typeof execFile>;
		}
		if (args[0] === "run") {
			done(null, { stdout: "container-id\n", stderr: "" });
			return {} as ReturnType<typeof execFile>;
		}
		done(null, { stdout: "", stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return {
		execFile: stub as unknown as typeof execFile,
		calls,
		releaseProbe: (state: string) => {
			probeCallbacks.shift()?.(null, { stdout: `${state}\n`, stderr: "" });
		},
		pendingProbes: () => probeCallbacks.length,
	};
}

/**
 * Stub for the exec-concurrency spike guard: non-exec docker commands (run/rm/inspect) complete immediately, but when
 * `gateExecs(true)` every `docker exec` is HELD (its callback parked) so a test can observe how many are in flight at
 * once. `execStarts` counts execs that reached docker (i.e. got past the semaphore); `held` is how many are parked now.
 */
function createExecGateStub(): {
	execFile: typeof execFile;
	execStarts: () => number;
	held: () => number;
	gateExecs: (on: boolean) => void;
	releaseAll: () => void;
	releaseOne: () => void;
} {
	let gate = false;
	let starts = 0;
	const heldCbs: (() => void)[] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (args[0] === "exec") {
			starts += 1;
			if (gate) {
				heldCbs.push(() => done(null, { stdout: "", stderr: "" }));
				return {} as ReturnType<typeof execFile>;
			}
		}
		done(null, { stdout: args[0] === "run" ? "container-id\n" : "", stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return {
		execFile: stub as unknown as typeof execFile,
		execStarts: () => starts,
		held: () => heldCbs.length,
		gateExecs: (on: boolean) => {
			gate = on;
		},
		releaseAll: () => {
			while (heldCbs.length > 0) {
				heldCbs.shift()?.();
			}
		},
		releaseOne: () => {
			heldCbs.shift()?.();
		},
	};
}

describe("agent sandbox interactive shell (todo §5.A)", () => {
	it("builds the interactive docker exec argv for a task shell", () => {
		const args = buildAgentSandboxInteractiveShellArgs({
			containerName: "klein-agent-sandbox-2",
			uid: 1234,
			workdir: "/workspaces/task-abc",
		});
		expect(args).toEqual([
			"exec",
			"-it",
			"-u",
			"1234",
			"-w",
			"/workspaces/task-abc",
			"klein-agent-sandbox-2",
			...DEFAULT_AGENT_SANDBOX_SHELL,
		]);
	});

	it("honours a custom shell argv", () => {
		const args = buildAgentSandboxInteractiveShellArgs({ containerName: "c1", uid: 0, workdir: "/workspaces/x" }, [
			"bash",
			"-l",
		]);
		expect(args).toEqual(["exec", "-it", "-u", "0", "-w", "/workspaces/x", "c1", "bash", "-l"]);
	});

	it("returns no shell target for a task without a prepared sandbox", () => {
		const manager = new AgentSandboxManager({ image: "test-image" });
		expect(manager.getTaskShellTarget("unprepared-task")).toBeNull();
	});

	it("spawns docker exec when the task has a sandbox target", () => {
		const spec = buildTaskShellSpawnSpec(
			{ containerName: "klein-agent-sandbox-1", uid: 1001, workdir: "/workspaces/t1" },
			{ binary: "/bin/zsh", args: ["-l"] },
		);
		expect(spec.usesSandbox).toBe(true);
		expect(spec.binary).toBe("docker");
		expect(spec.args).toEqual([
			"exec",
			"-it",
			"-u",
			"1001",
			"-w",
			"/workspaces/t1",
			"klein-agent-sandbox-1",
			...DEFAULT_AGENT_SANDBOX_SHELL,
		]);
	});

	it("falls back to the host shell when there is no sandbox target", () => {
		const spec = buildTaskShellSpawnSpec(null, { binary: "/bin/zsh", args: ["-l"] });
		expect(spec).toEqual({ binary: "/bin/zsh", args: ["-l"], usesSandbox: false });
	});
});

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

	it("maps the capability network policy to docker --network args (allowlist fails closed)", () => {
		expect(resolveAgentSandboxNetworkArgs("none")).toEqual(["--network", "none"]);
		expect(resolveAgentSandboxNetworkArgs("full")).toEqual(["--network", "bridge"]);
		// allowlist has no real egress filter yet, so it denies rather than over-grants.
		expect(resolveAgentSandboxNetworkArgs("allowlist")).toEqual(["--network", "none"]);
	});

	it("defaults to an isolated network and opens egress only for the full policy, keeping isolation flags", () => {
		const base = {
			slot: 1,
			image: "test-image",
			projectMounts: [],
			config: normalizeAgentSandboxPoolConfig({ maxContainers: 1, agentsPerContainer: 1 }),
		} as const;

		const defaulted = buildAgentSandboxDockerRunArgs(base);
		expect(defaulted.join(" ")).toContain("--network none");

		const full = buildAgentSandboxDockerRunArgs({ ...base, networkPolicy: "full" });
		expect(full.join(" ")).toContain("--network bridge");
		expect(full.join(" ")).not.toContain("--network none");
		// Opening egress must not drop any other isolation flag.
		for (const flag of ["--cap-drop", "ALL", "--read-only", "no-new-privileges"]) {
			expect(full).toContain(flag);
		}
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

	it("notifies only tasks that actually wait for sandbox capacity", async () => {
		const { execFile: execFileStub } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 1,
				agentsPerContainer: 1,
				idleTimeoutMs: 0,
			},
		});
		const firstQueued = vi.fn();
		const secondQueued = vi.fn();

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo", onQueued: firstQueued });
		const queued = manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo", onQueued: secondQueued });
		await Promise.resolve();

		expect(firstQueued).not.toHaveBeenCalled();
		expect(secondQueued).toHaveBeenCalledTimes(1);

		await manager.disposeWorkspace("task-1");
		await expect(queued).resolves.toMatchObject({ taskId: "task-2", slot: 1 });
	});

	it("enforces shared workspace root permissions before creating a task workspace", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await expect(
			manager.prepareWorkspace({
				taskId: "task-1",
				projectRepoPath: "/repo",
				baseRef: "HEAD",
			}),
		).resolves.toEqual({
			workdir: "/workspaces/task-1",
			uid: createAgentSandboxTaskUid("task-1"),
		});

		const mkdirRootCallIndex = calls.findIndex(
			(args) => args.join(" ") === "exec -u 0:0 -w /workspaces nklein-agent-sandbox-1 mkdir -p /workspaces",
		);
		const chmodRootCallIndex = calls.findIndex(
			(args) => args.join(" ") === "exec -u 0:0 -w /workspaces nklein-agent-sandbox-1 chmod 1777 /workspaces",
		);
		const mkdirTaskCallIndex = calls.findIndex(
			(args) =>
				args.join(" ") ===
				`exec -u ${createAgentSandboxTaskUid("task-1")} -w /workspaces nklein-agent-sandbox-1 mkdir -m 700 -p /workspaces/task-1`,
		);
		// A stale workspace at the task path is cleared BEFORE the (re)create + clone, so a leftover from a prior
		// run that didn't dispose cleanly can't block `git clone` with "destination path already exists / not empty".
		const rmStaleCallIndex = calls.findIndex(
			(args) =>
				args.join(" ") ===
				`exec -u ${createAgentSandboxTaskUid("task-1")} -w /workspaces nklein-agent-sandbox-1 rm -rf /workspaces/task-1`,
		);
		const cloneCallIndex = calls.findIndex((args) => args.includes("clone"));

		expect(mkdirRootCallIndex).toBeGreaterThanOrEqual(0);
		expect(chmodRootCallIndex).toBeGreaterThan(mkdirRootCallIndex);
		expect(rmStaleCallIndex).toBeGreaterThan(chmodRootCallIndex);
		expect(mkdirTaskCallIndex).toBeGreaterThan(rmStaleCallIndex);
		expect(cloneCallIndex).toBeGreaterThan(mkdirTaskCallIndex);
	});

	it("reports workspace cleanup failures without leaking the pool slot", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub({
			failExecCommand: ["rm", "-rf", "/workspaces/task-1"],
		});
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
		await expect(manager.disposeWorkspace("task-1")).rejects.toThrow("Could not remove sandbox task workspace.");
		await expect(manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" })).resolves.toMatchObject({
			taskId: "task-2",
			slot: 1,
		});
		expect(calls).toContainEqual([
			"exec",
			"-u",
			String(createAgentSandboxTaskUid("task-1")),
			"-w",
			"/workspaces",
			"nklein-agent-sandbox-1",
			"rm",
			"-rf",
			"/workspaces/task-1",
		]);
	});

	it("derives one canonical project key for every spelling of the same directory (run19)", async () => {
		const { mkdtempSync, realpathSync, rmSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		// macOS tmpdir is itself a symlink (/var/folders -> /private/var/folders) — the exact run19 pair.
		const viaSymlink = mkdtempSync(join(tmpdir(), "nklein-key-"));
		try {
			const resolved = realpathSync(viaSymlink);
			expect(createAgentSandboxProjectKey(viaSymlink)).toBe(createAgentSandboxProjectKey(resolved));
		} finally {
			rmSync(viaSymlink, { recursive: true, force: true });
		}
		// Nonexistent paths still key deterministically off the raw string (never throw).
		expect(createAgentSandboxProjectKey("/no/such/path")).toBe(createAgentSandboxProjectKey("/no/such/path"));
	});

	it("never assigns a task to a running container missing its project mount — retires the empty stale container and restarts with fresh mounts (run19)", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-a", projectRepoPath: "/no/such/repo-a" });
		await manager.disposeWorkspace("task-a");
		// The container is still running, but its mounts were baked at start — /repos/<key-b> does not exist
		// inside it. Assigning task-b there would fail `git clone` (run19's "repository does not exist").
		const second = await manager.acquireSlot({ taskId: "task-b", projectRepoPath: "/no/such/repo-b" });
		expect(second.taskId).toBe("task-b");

		const runs = calls.filter((args) => args[0] === "run");
		expect(runs).toHaveLength(2);
		const keyB = createAgentSandboxProjectKey("/no/such/repo-b");
		expect(runs[1]?.join(" ")).toContain(`dst=/repos/${keyB}`);
		// The stale container was retired (docker rm -f) before the fresh start.
		const removals = calls.filter((args) => args[0] === "rm" && args.includes("nklein-agent-sandbox-1"));
		expect(removals.length).toBeGreaterThanOrEqual(2);
	});

	it("detects a cached container that died out-of-band and recreates it on the next acquire (dead-container recovery)", async () => {
		// Bug 2026-07-04: a pooled container that dies OUT-OF-BAND (OOM inside the Docker VM, a docker restart, a
		// manual rm) leaves its cached containerId pointing at nothing. Reusing that id makes every later docker
		// exec fail with "No such container". The reuse path must probe liveness and re-create a dead slot.
		const { execFile: execFileStub, calls } = createExecFileStub({
			// First reuse probe (for task-2) reports the container as dead; any later probe reports alive again.
			inspectRunningState: (index) => (index === 0 ? "false" : "true"),
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 1, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.disposeWorkspace("task-1");
		// The container stays pooled with a cached containerId (idleTimeoutMs=0 disarms teardown). It then dies
		// out-of-band before task-2 reuses it — the liveness probe must catch that and recreate the slot.
		const second = await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		expect(second).toMatchObject({ taskId: "task-2", slot: 1 });

		// A dead container is re-created: a second docker run and a second `rm -f` of the slot name.
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
		expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1").length).toBeGreaterThanOrEqual(
			2,
		);
		// The liveness probe actually ran on the reuse.
		expect(calls).toContainEqual(["inspect", "-f", "{{.State.Running}}", "nklein-agent-sandbox-1"]);
	});

	it("treats a genuinely missing container (inspect 'No such container') as dead and recreates it", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub({
			inspectRunningState: (index) => (index === 0 ? "MISSING" : "true"),
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 1, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.disposeWorkspace("task-1");
		const second = await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		expect(second).toMatchObject({ taskId: "task-2", slot: 1 });

		expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
	});

	it("does NOT recreate a container that is still alive on reuse (happy path unchanged)", async () => {
		// A cached, LIVE container must be reused as-is — the added liveness probe must not perturb the hot path.
		const { execFile: execFileStub, calls } = createExecFileStub({
			inspectRunningState: () => "true",
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 1, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.disposeWorkspace("task-1");
		const second = await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		expect(second).toMatchObject({ taskId: "task-2", slot: 1 });

		// Alive container is reused: exactly one docker run and one `rm -f` (from the very first start) — no recreate.
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
		expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1")).toHaveLength(1);
	});

	it("keeps a container (no recreate) when the liveness probe is inconclusive — never tears out a live co-occupant", async () => {
		// CRITICAL multi-occupancy safety: a false "dead" verdict must NEVER rm/recreate a container that is still
		// alive and hosting other occupants. When the inspect itself fails (docker daemon flakiness/timeout), that is
		// NOT proof the container died, so the fix conservatively KEEPS the container. Here a live co-occupant
		// (agentsPerContainer=0 = unlimited) shares the slot while a new reuse probe fails — the slot must survive.
		const { execFile: execFileStub, calls } = createExecFileStub({
			// The reuse probe for task-2 fails (daemon down); the container is genuinely alive and hosting task-1.
			inspectRunningState: () => "THROW",
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		// task-2 co-occupies the SAME container; the reuse liveness probe fails (inconclusive) — keep the container.
		const second = await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		expect(second).toMatchObject({ taskId: "task-2", slot: 1 });

		// No recreate: still exactly one docker run, and the co-occupant task-1 was not torn out.
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
		expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1")).toHaveLength(1);
		// Both occupants keep working — the manager still holds a live workspace for each.
		expect(manager.hasWorkspace("task-1")).toBe(true);
		expect(manager.hasWorkspace("task-2")).toBe(true);
	});

	it("issues EXACTLY ONE liveness probe under concurrent reuse of a dead container — the single-flight guard (race, C3 review 2026-07-04)", async () => {
		// The discriminating regression guard for the double-recreate RACE. The pre-fix code awaited the liveness
		// probe BEFORE the single-flight `starting` guard, so N concurrent reusers each probed + each could recreate →
		// a second `docker run --name <same>` that Conflicts. The fix runs the whole liveness+recreate+start under ONE
		// `starting` promise (set synchronously), so the 2nd concurrent reuser awaits the 1st instead of probing. We
		// HOLD the probe and assert only ONE is in flight: the pre-fix probe-before-guard code would show TWO here.
		const { execFile: execFileStub, calls, releaseProbe, pendingProbes } = createProbeBarrierExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});
		const tick = () => new Promise((resolve) => setImmediate(resolve));

		// task-1 creates the pooled container (a fresh container is not probed; `run` completes immediately).
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.disposeWorkspace("task-1");

		// Two tasks concurrently reuse the SAME cached container; the reuse liveness probe is HELD.
		const t2 = manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		const t3 = manager.acquireSlot({ taskId: "task-3", projectRepoPath: "/repo" });
		await tick();
		await tick();

		// SINGLE-FLIGHT: exactly ONE probe is in flight — task-3 awaits task-2's `starting` promise rather than
		// probing itself. The pre-fix code (probe before the guard) would have TWO probes pending here (one per caller).
		expect(pendingProbes()).toBe(1);
		expect(calls.filter((args) => args[0] === "inspect")).toHaveLength(1);

		// Release the single probe as DEAD → exactly one recreate, shared by both reusers.
		releaseProbe("false");
		const [p2, p3] = await Promise.all([t2, t3]);
		expect(p2).toMatchObject({ taskId: "task-2", slot: 1 });
		expect(p3).toMatchObject({ taskId: "task-3", slot: 1 });
		// task-1's initial run + exactly ONE recovery run (not two) despite the two concurrent reusers.
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
	});

	it("bounds concurrent in-container execs to maxConcurrentExec — the spike guard (2026-07-04)", async () => {
		// The ONE shared container hosts every agent; each `docker exec` (npm/build/acceptance) can spike to ~1–2 GiB,
		// so simultaneous heavy commands used to OOM it. The exec-concurrency cap FIFO-queues excess commands so at most
		// `maxConcurrentExec` run at once — the container is sized against THAT bound, not the (unbounded) agent count.
		const gate = createExecGateStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: gate.execFile,
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0, maxConcurrentExec: 2 },
		});
		const tick = () => new Promise((resolve) => setImmediate(resolve));
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" }); // container `run`; no execs yet

		// Fire FIVE concurrent in-container commands with exec gated open.
		gate.gateExecs(true);
		const execs = Array.from({ length: 5 }, (_, i) => manager.exec("task-1", ["echo", String(i)]));
		await tick();
		await tick();
		// Only 2 reached docker; the other 3 are queued behind the semaphore.
		expect(gate.held()).toBe(2);
		expect(gate.execStarts()).toBe(2);

		// Completing ONE lets exactly one queued command in — never more than the cap in flight.
		gate.releaseOne();
		await tick();
		await tick();
		expect(gate.held()).toBe(2);
		expect(gate.execStarts()).toBe(3);

		// Drain: ungate + release the held ones; every command eventually runs, capped throughout.
		gate.gateExecs(false);
		gate.releaseAll();
		await tick();
		await tick();
		await Promise.all(execs);
		expect(gate.execStarts()).toBe(5);
	});

	it("maxConcurrentExec=0 disables the spike guard (in-container execs run unbounded)", async () => {
		const gate = createExecGateStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: gate.execFile,
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0, maxConcurrentExec: 0 },
		});
		const tick = () => new Promise((resolve) => setImmediate(resolve));
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		gate.gateExecs(true);
		const execs = Array.from({ length: 5 }, (_, i) => manager.exec("task-1", ["echo", String(i)]));
		await tick();
		await tick();
		// No cap → all 5 reach docker at once.
		expect(gate.held()).toBe(5);
		gate.releaseAll();
		await Promise.all(execs);
	});

	it("rejects a bounded queued acquisition when no slot opens in time, without leaking the later-freed slot", async () => {
		const { execFile: execFileStub } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: { maxContainers: 1, agentsPerContainer: 1, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		// Auxiliary acquisitions (review sessions, acceptance re-checks) must NEVER wait forever — the slot
		// holder may be waiting on the very check that queued (the review-seam freeze class).
		await expect(
			manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo", maxQueueWaitMs: 40 }),
		).rejects.toThrow(/No sandbox slot opened within/);

		// Freeing the holder afterwards must not leak the slot to the dead waiter: a new task gets it.
		await manager.disposeWorkspace("task-1");
		await expect(manager.acquireSlot({ taskId: "task-3", projectRepoPath: "/repo" })).resolves.toMatchObject({
			taskId: "task-3",
			slot: 1,
		});
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

	it("queues the third task when one container allows two agents", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 1,
				agentsPerContainer: 2,
				idleTimeoutMs: 0,
			},
		});

		const first = await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		const second = await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		const thirdQueued = manager.acquireSlot({ taskId: "task-3", projectRepoPath: "/repo" });
		let thirdResolved = false;
		void thirdQueued.then(() => {
			thirdResolved = true;
		});
		await Promise.resolve();

		expect(first.slot).toBe(1);
		expect(second.slot).toBe(1);
		expect(thirdResolved).toBe(false);

		await manager.disposeWorkspace("task-1");
		await expect(thirdQueued).resolves.toMatchObject({ taskId: "task-3", slot: 1 });
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
	});

	it("starts two dedicated containers with configured resource caps", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 2,
				agentsPerContainer: 1,
				memoryPerContainerMb: 8192,
				cpusPerContainer: 1.5,
				idleTimeoutMs: 0,
			},
		});

		const first = await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		const second = await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		const thirdQueued = manager.acquireSlot({ taskId: "task-3", projectRepoPath: "/repo" });
		let thirdResolved = false;
		void thirdQueued.then(() => {
			thirdResolved = true;
		});
		await Promise.resolve();

		expect(first.slot).toBe(1);
		expect(second.slot).toBe(2);
		expect(thirdResolved).toBe(false);
		const runCalls = calls.filter((args) => args[0] === "run");
		expect(runCalls).toHaveLength(2);
		for (const runCall of runCalls) {
			expect(runCall).toContain("--memory");
			expect(runCall).toContain("8192m");
			expect(runCall).toContain("--cpus");
			expect(runCall).toContain("1.5");
		}

		await manager.disposeWorkspace("task-1");
		await expect(thirdQueued).resolves.toMatchObject({ taskId: "task-3", slot: 1 });
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
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

	it("reaps idle containers that become excess after lowering maxContainers", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 2,
				agentsPerContainer: 1,
				idleTimeoutMs: 0,
			},
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		await manager.disposeWorkspace("task-1");
		await manager.disposeWorkspace("task-2");

		const slotOneRmCountBeforeLowering = calls.filter(
			(args) => args.join(" ") === "rm -f nklein-agent-sandbox-1",
		).length;
		const slotTwoRmCountBeforeLowering = calls.filter(
			(args) => args.join(" ") === "rm -f nklein-agent-sandbox-2",
		).length;

		await manager.updatePoolConfig({
			maxContainers: 1,
			agentsPerContainer: 1,
			idleTimeoutMs: 0,
		});

		expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-1")).toHaveLength(
			slotOneRmCountBeforeLowering,
		);
		expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-2")).toHaveLength(
			slotTwoRmCountBeforeLowering + 1,
		);
		expect(calls).toContainEqual(["volume", "rm", "nklein-agent-ws-2"]);
		expect(calls).not.toContainEqual(["volume", "rm", "nklein-agent-ws-1"]);
	});

	it("retires occupied excess containers only after their active task releases", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			poolConfig: {
				maxContainers: 2,
				agentsPerContainer: 1,
				idleTimeoutMs: 0,
			},
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });
		const slotTwoRmCountBeforeLowering = calls.filter(
			(args) => args.join(" ") === "rm -f nklein-agent-sandbox-2",
		).length;

		await manager.updatePoolConfig({
			maxContainers: 1,
			agentsPerContainer: 1,
			idleTimeoutMs: 0,
		});

		expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-2")).toHaveLength(
			slotTwoRmCountBeforeLowering,
		);

		const queued = manager.acquireSlot({ taskId: "task-3", projectRepoPath: "/repo" });
		let queuedResolved = false;
		void queued.then(() => {
			queuedResolved = true;
		});
		await Promise.resolve();

		expect(queuedResolved).toBe(false);

		await manager.disposeWorkspace("task-2");
		await vi.waitFor(() => {
			expect(calls.filter((args) => args.join(" ") === "rm -f nklein-agent-sandbox-2")).toHaveLength(
				slotTwoRmCountBeforeLowering + 1,
			);
		});
		expect(queuedResolved).toBe(false);

		await manager.disposeWorkspace("task-1");
		await expect(queued).resolves.toMatchObject({ taskId: "task-3", slot: 1 });
		expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);
		expect(calls).toContainEqual(["volume", "rm", "nklein-agent-ws-2"]);
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
			"/opt/nklein/tool-runner.cjs",
			"editor",
			JSON.stringify({ command: "replace" }),
			"/repo",
		]);
	});

	it("adds next-step guidance when sandbox tool execution fails", async () => {
		const input = "npm test";
		const { execFile: execFileStub } = createExecFileStub({
			failExecCommand: ["node", "/opt/nklein/tool-runner.cjs", "bash", JSON.stringify(input), "/repo"],
		});
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await expect(manager.runTool("task-1", "bash", input)).rejects.toThrow(AgentSandboxExecutionError);
		await expect(manager.runTool("task-1", "bash", input)).rejects.toThrow("Next step:");
	});

	it("adds next-step guidance when the sandbox tool runner returns a failed result", async () => {
		const { execFile: execFileStub } = createExecFileStub({
			execStdout: JSON.stringify({ ok: false, error: "Command Failed: npm test" }),
		});
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await expect(manager.runTool("task-1", "bash", "npm test")).rejects.toThrow("Command Failed: npm test");
		await expect(manager.runTool("task-1", "bash", "npm test")).rejects.toThrow("Next step:");
	});

	it("captures a staged binary workspace patch against the task base ref", async () => {
		const patch = "diff --git a/README.md b/README.md\n";
		const { execFile: execFileStub, calls } = createExecFileStub({ execStdout: patch });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await expect(manager.captureWorkspacePatch("task-1", { baseRef: "main" })).resolves.toBe(patch);
		expect(calls).toContainEqual([
			"exec",
			"-u",
			String(createAgentSandboxTaskUid("task-1")),
			"-w",
			"/workspaces/task-1",
			"nklein-agent-sandbox-1",
			"git",
			"add",
			"-A",
		]);
		expect(calls).toContainEqual([
			"exec",
			"-u",
			String(createAgentSandboxTaskUid("task-1")),
			"-w",
			"/workspaces/task-1",
			"nklein-agent-sandbox-1",
			"git",
			"diff",
			"--staged",
			"--binary",
			"main",
			"--",
		]);
	});

	it("captures a staged binary workspace patch from HEAD when no base ref is available", async () => {
		const patch = "diff --git a/README.md b/README.md\n";
		const { execFile: execFileStub, calls } = createExecFileStub({ execStdout: patch });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await expect(manager.captureWorkspacePatch("task-1")).resolves.toBe(patch);
		expect(calls).toContainEqual([
			"exec",
			"-u",
			String(createAgentSandboxTaskUid("task-1")),
			"-w",
			"/workspaces/task-1",
			"nklein-agent-sandbox-1",
			"git",
			"diff",
			"--staged",
			"--binary",
		]);
	});

	it("fails closed when sandbox patch staging fails", async () => {
		const { execFile: execFileStub } = createExecFileStub({ failExecCommand: ["git", "add", "-A"] });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await expect(manager.captureWorkspacePatch("task-1")).rejects.toThrow(
			"Could not stage sandbox workspace changes.",
		);
	});

	it("queues tool execution while the task is paused", async () => {
		const pauseController = new NKleinPauseController();
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
		const pauseController = new NKleinPauseController();
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

describe("resolveNKleinAgentPerceivedCwd + agent system-prompt host-path isolation", () => {
	it("returns the in-container sandbox workdir for a task, and the host cwd only for a home session", () => {
		const hostCwd = "/private/var/folders/zz/T/nklein-host-project";
		// A real task: the perceived cwd is the sandbox workdir, never the host mount.
		expect(resolveNKleinAgentPerceivedCwd("task-1", hostCwd)).toBe("/workspaces/task-1");
		expect(resolveNKleinAgentPerceivedCwd("task-1", hostCwd)).toBe(buildAgentSandboxWorkdir("task-1"));
		// A home/chat session is not sandbox-backed, so it keeps the host cwd.
		const homeSessionId = createHomeAgentSessionId("workspace-1", "nklein");
		expect(resolveNKleinAgentPerceivedCwd(homeSessionId, "/Users/me/project")).toBe("/Users/me/project");
	});

	// Regression for the §5.A HARDEN leak the live decompose verification caught: the SDK system prompt embeds the
	// cwd as an `<env>` "Working Directory" line for EVERY provider. Building it from the host cwd told a sandboxed
	// agent its working directory was the host mount, so it then read/list host absolute paths. The prompt must
	// carry the sandbox workdir, never the host path. (Exercises the real SDK prompt builder.)
	it("builds the agent system prompt with the sandbox working directory, never the host mount", async () => {
		const hostCwd = "/private/var/folders/zz/T/nklein-host-XYZ/specs";
		const prompt = await resolveNKleinSdkSystemPrompt({
			cwd: resolveNKleinAgentPerceivedCwd("task-7", hostCwd),
			providerId: "lmstudio",
			rules: "",
		});
		expect(prompt).not.toContain(hostCwd);
		expect(prompt).toContain("/workspaces/task-7");
	});
});
