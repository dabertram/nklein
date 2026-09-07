import type { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const observations: { message: string; metadata?: Record<string, unknown> }[] = [];
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: (event: { message: string; metadata?: Record<string, unknown> }) => {
		observations.push(event);
	},
	readSelfObservationEvents: async () => [],
}));

import {
	AgentSandboxManager,
	AgentSandboxUnavailableError,
	SANDBOX_CAPTURE_OWED_FINALIZE,
} from "../../../src/nklein-agent/nklein-agent-sandbox";

/**
 * P1.CAPTURERACE — a sandbox workspace must not be disposed while a capture is still OWED or an exec is still in
 * flight.
 *
 * ── WHAT THESE COVER THAT THE EXISTING SERIALIZATION TESTS DO NOT ──
 * `nklein-agent-sandbox.test.ts` already proves the workspace lifecycle lock serializes a capture that has ALREADY
 * STARTED against a same-task disposal. That lock is mutual exclusion by ARRIVAL ORDER, and both live failures of
 * 2026-09-07 slipped through underneath it:
 *
 *  - The disposal arrived FIRST and won the lock legitimately; the capture behind it found no placement and the
 *    card ended `failed` with `workspace_disposed_before_capture`.
 *  - `seedTaskPackageCache` / `exec` / `runTool` never entered the lock at all — they take a placement and run —
 *    so a concurrent disposal deleted the workdir under a live `docker exec`
 *    (`OCI runtime exec failed: … chdir to cwd ("/workspaces/<task>") … no such file or directory`).
 *
 * So these tests drive the manager's PUBLIC API and assert on the docker argv the fake runner recorded: the
 * ordering of `rm -rf /workspaces/<task>` against the work it must not interrupt.
 */

interface DockerCall {
	args: string[];
}

/** Whether a recorded docker argv is the disposal's workspace removal. */
function isWorkspaceRemoval(args: readonly string[], taskId: string): boolean {
	return args[0] === "exec" && args.includes("rm") && args.includes(`/workspaces/${taskId}`);
}

/** Whether a recorded docker argv is a `docker exec` running `command` inside the container. */
function isExecOf(args: readonly string[], command: string): boolean {
	return args[0] === "exec" && args.includes(command);
}

/**
 * A fake docker runner that can HOLD any exec matching `holdWhen` until the test releases it — the barrier that
 * makes "is the disposal waiting for this?" observable. Everything else completes immediately.
 */
function createHoldableExecFileStub(options: {
	holdWhen: (command: readonly string[]) => boolean;
	execStdout?: string;
}): {
	execFile: typeof execFile;
	calls: DockerCall[];
	pendingHolds: () => number;
	releaseHold: (outcome?: { code: number; stderr: string }) => void;
} {
	const calls: DockerCall[] = [];
	const held: ((error: unknown, result?: { stdout: string; stderr: string }) => void)[] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push({ args: [...args] });
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (args[0] === "run") {
			done(null, { stdout: "container-id\n", stderr: "" });
			return {} as ReturnType<typeof execFile>;
		}
		if (args[0] === "inspect" && args[1] === "-f" && args[2] === "{{.State.Running}}") {
			done(null, { stdout: "true\n", stderr: "" });
			return {} as ReturnType<typeof execFile>;
		}
		if (args[0] === "exec" && options.holdWhen(args)) {
			held.push(done);
			return {} as ReturnType<typeof execFile>;
		}
		done(null, { stdout: options.execStdout ?? "", stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return {
		execFile: stub as unknown as typeof execFile,
		calls,
		pendingHolds: () => held.length,
		releaseHold: (outcome) => {
			const done = held.shift();
			if (!done) {
				return;
			}
			if (outcome) {
				done(
					Object.assign(new Error("held exec failed"), { code: outcome.code, stdout: "", stderr: outcome.stderr }),
				);
				return;
			}
			done(null, { stdout: "", stderr: "" });
		},
	};
}

/** Let every already-queued microtask/macrotask settle so a parked promise has had its chance to proceed. */
async function settle(): Promise<void> {
	for (let index = 0; index < 5; index += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

describe("AgentSandboxManager owed-capture lease (P1.CAPTURERACE)", () => {
	it("parks a disposal while a capture is OWED, so the later capture still finds its workspace", async () => {
		// The live shape: the finalizer DECLARES the capture, then yields; a disposal path that knows nothing about
		// the obligation arrives before the capture does. Pre-fix, the disposal won and the capture failed with
		// `workspace_disposed_before_capture`.
		const { execFile: execFileStub, calls } = createHoldableExecFileStub({
			holdWhen: () => false,
			execStdout: "diff --git a/a b/a\n",
		});
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		manager.markCaptureOwed("task-1", SANDBOX_CAPTURE_OWED_FINALIZE);

		const dispose = manager.disposeWorkspace("task-1");
		await settle();
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(false);

		const patch = await manager.captureWorkspacePatch("task-1", { baseRef: "main" });
		expect(patch).toContain("diff --git");

		manager.releaseOwedCapture("task-1", SANDBOX_CAPTURE_OWED_FINALIZE);
		await dispose;
		const diffIndex = calls.findIndex((call) => isExecOf(call.args, "diff"));
		const removalIndex = calls.findIndex((call) => isWorkspaceRemoval(call.args, "task-1"));
		expect(diffIndex).toBeGreaterThanOrEqual(0);
		expect(removalIndex).toBeGreaterThan(diffIndex);
	});

	it("releases only the named obligation, and ignores one that was never marked", async () => {
		const { execFile: execFileStub, calls } = createHoldableExecFileStub({ holdWhen: () => false });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		manager.markCaptureOwed("task-1", SANDBOX_CAPTURE_OWED_FINALIZE);
		manager.markCaptureOwed("task-1", SANDBOX_CAPTURE_OWED_FINALIZE); // idempotent per reason
		manager.releaseOwedCapture("task-1", "some_other_reason");

		const dispose = manager.disposeWorkspace("task-1");
		await settle();
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(false);

		manager.releaseOwedCapture("task-1", SANDBOX_CAPTURE_OWED_FINALIZE);
		await dispose;
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(true);
	});

	it("never waits on an obligation with no placement to protect", async () => {
		// A marker that outlived its task must not tax every later disposal for the full drain window — and a mark
		// against a task that has no placement is meaningless, so it is not even recorded.
		const { execFile: execFileStub } = createHoldableExecFileStub({ holdWhen: () => false });
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			disposeLeaseWaitMs: 60_000,
		});
		manager.markCaptureOwed("never-placed", SANDBOX_CAPTURE_OWED_FINALIZE);
		const startedAt = Date.now();
		await manager.disposeWorkspace("never-placed");
		expect(Date.now() - startedAt).toBeLessThan(1_000);
	});

	it("does not stall a stale-placement reclaim on an obligation the missing workspace can never serve", async () => {
		// The redrive restore probes the Docker cwd, finds it gone, and disposes to re-prepare. A recapture owed by
		// the previous round is real, but no wait can serve it from a workspace that no longer exists — stalling
		// there would only delay the re-drive and file a false "interrupted" observation.
		observations.length = 0;
		const { execFile: execFileStub, calls } = createHoldableExecFileStub({ holdWhen: () => false });
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			disposeLeaseWaitMs: 60_000,
		});
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		manager.markCaptureOwed("task-1", "recapture_expected");

		const startedAt = Date.now();
		await manager.disposeWorkspace("task-1", { workspaceAlreadyGone: true });
		expect(Date.now() - startedAt).toBeLessThan(1_000);
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(true);
		expect(observations.some((event) => event.metadata?.category === "sandbox_dispose_interrupted_lease")).toBe(
			false,
		);
	});

	it("still waits for an in-flight exec even when owed captures are ignored", async () => {
		const {
			execFile: execFileStub,
			calls,
			pendingHolds,
			releaseHold,
		} = createHoldableExecFileStub({ holdWhen: (args) => args.includes("sleep-forever") });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		manager.markCaptureOwed("task-1", "recapture_expected");

		const running = manager.exec("task-1", ["sleep-forever"]);
		await vi.waitFor(() => expect(pendingHolds()).toBe(1));
		const dispose = manager.disposeWorkspace("task-1", { workspaceAlreadyGone: true });
		await settle();
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(false);

		releaseHold();
		await running;
		await dispose;
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(true);
	});

	it("drops every obligation for a task at the terminal forget seam", async () => {
		const { execFile: execFileStub, calls } = createHoldableExecFileStub({ holdWhen: () => false });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		manager.markCaptureOwed("task-1", SANDBOX_CAPTURE_OWED_FINALIZE);
		manager.markCaptureOwed("task-1", "recapture_expected");
		manager.releaseAllOwedCaptures("task-1");

		await manager.disposeWorkspace("task-1");
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(true);
	});
});

describe("AgentSandboxManager in-flight exec lease (P1.CAPTURERACE)", () => {
	it("does not delete the workdir under an exec that never entered the lifecycle lock", async () => {
		// `exec` (and through it the npm-cache seed, the toolchain prime, every tool call) takes a placement and
		// runs OUTSIDE `withWorkspaceLifecycle`. That is the hole the seed's `chdir to cwd … no such file or
		// directory` came through.
		const {
			execFile: execFileStub,
			calls,
			pendingHolds,
			releaseHold,
		} = createHoldableExecFileStub({
			holdWhen: (args) => args.includes("sleep-forever"),
		});
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		const running = manager.exec("task-1", ["sleep-forever"]);
		await vi.waitFor(() => expect(pendingHolds()).toBe(1));

		const dispose = manager.disposeWorkspace("task-1");
		await settle();
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(false);

		releaseHold();
		await expect(running).resolves.toMatchObject({ exitCode: 0 });
		await dispose;
		const execIndex = calls.findIndex((call) => isExecOf(call.args, "sleep-forever"));
		const removalIndex = calls.findIndex((call) => isWorkspaceRemoval(call.args, "task-1"));
		expect(execIndex).toBeGreaterThanOrEqual(0);
		expect(removalIndex).toBeGreaterThan(execIndex);
	});

	it("keeps waiting when a FRESH exec arrives just as the first settles", async () => {
		// The one-shot version of this wait closed the window it was watching and handed control back — during
		// which a new tool call can start, and the disposal would delete the workdir under THAT one instead. The
		// drain re-reads until the placement is genuinely idle (or its shared deadline expires).
		const {
			execFile: execFileStub,
			calls,
			pendingHolds,
			releaseHold,
		} = createHoldableExecFileStub({ holdWhen: (args) => args.includes("sleep-forever") });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		const first = manager.exec("task-1", ["sleep-forever", "first"]);
		await vi.waitFor(() => expect(pendingHolds()).toBe(1));
		const dispose = manager.disposeWorkspace("task-1");
		await settle();

		const second = manager.exec("task-1", ["sleep-forever", "second"]);
		await vi.waitFor(() => expect(pendingHolds()).toBe(2));
		releaseHold();
		await first;
		await settle();
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(false);

		releaseHold();
		await second;
		await dispose;
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(true);
	});

	it("disposes ANYWAY when the drain times out, and records exactly one observation naming what it interrupted", async () => {
		// TOTALITY. A disposal that blocks forever on work that never settles leaks a pool slot, and a leaked slot
		// freezes the whole run — strictly worse than losing the interrupted command's result.
		observations.length = 0;
		const {
			execFile: execFileStub,
			calls,
			pendingHolds,
			releaseHold,
		} = createHoldableExecFileStub({
			holdWhen: (args) => args.includes("sleep-forever"),
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			disposeLeaseWaitMs: 10,
		});
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		manager.markCaptureOwed("task-1", SANDBOX_CAPTURE_OWED_FINALIZE);

		const running = manager.exec("task-1", ["sleep-forever"]);
		await vi.waitFor(() => expect(pendingHolds()).toBe(1));

		await manager.disposeWorkspace("task-1");
		expect(calls.some((call) => isWorkspaceRemoval(call.args, "task-1"))).toBe(true);

		const interrupted = observations.filter(
			(event) => event.metadata?.category === "sandbox_dispose_interrupted_lease",
		);
		expect(interrupted).toHaveLength(1);
		expect(interrupted[0]?.metadata).toMatchObject({
			execsInFlight: 1,
			capturesOwed: [SANDBOX_CAPTURE_OWED_FINALIZE],
		});
		expect(interrupted[0]?.message).toContain("sandbox exec(s) still in flight");
		expect(interrupted[0]?.message).toContain(SANDBOX_CAPTURE_OWED_FINALIZE);

		// The interrupted exec must come back SKIPPED, not as a docker failure blamed on the command.
		releaseHold({ code: 126, stderr: 'OCI runtime exec failed: chdir to cwd ("/workspaces/task-1")' });
		await expect(running).resolves.toMatchObject({ exitCode: null, skipped: true });
	});

	it("reports a tool call interrupted by a disposal as unavailable, not as a tool failure", async () => {
		const {
			execFile: execFileStub,
			pendingHolds,
			releaseHold,
		} = createHoldableExecFileStub({
			holdWhen: (args) => args.includes("/opt/nklein/tool-runner.cjs"),
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			disposeLeaseWaitMs: 10,
		});
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		const running = manager.runTool("task-1", "readFile", { path: "a.ts" });
		await vi.waitFor(() => expect(pendingHolds()).toBe(1));
		await manager.disposeWorkspace("task-1");

		releaseHold({ code: 126, stderr: 'OCI runtime exec failed: chdir to cwd ("/workspaces/task-1")' });
		await expect(running).rejects.toThrowError(AgentSandboxUnavailableError);
		await expect(running).rejects.toThrowError(/disposed while its readFile tool call was running/);
	});

	it("keeps a SUCCESSFUL exec's result even when the placement went away meanwhile", async () => {
		// The command ran and its output is real; only a FAILURE is re-read as an interruption.
		const {
			execFile: execFileStub,
			pendingHolds,
			releaseHold,
		} = createHoldableExecFileStub({
			holdWhen: (args) => args.includes("sleep-forever"),
		});
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			disposeLeaseWaitMs: 10,
		});
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		const running = manager.exec("task-1", ["sleep-forever"]);
		await vi.waitFor(() => expect(pendingHolds()).toBe(1));
		await manager.disposeWorkspace("task-1");

		releaseHold();
		const result = await running;
		expect(result.exitCode).toBe(0);
		expect(result.skipped).toBeUndefined();
	});
});
