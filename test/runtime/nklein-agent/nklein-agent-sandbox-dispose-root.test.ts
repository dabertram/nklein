import type { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const observations: { message: string; severity?: string; metadata?: Record<string, unknown> }[] = [];
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: (event: { message: string; severity?: string; metadata?: Record<string, unknown> }) => {
		observations.push(event);
	},
	readSelfObservationEvents: async () => [],
}));

import { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";

/**
 * P0.AUDIT0904 leg 17 — a workspace that could not be removed leaked silently.
 *
 * `prepareWorkspace` learned on 2026-09-03 that a task tree can hold foreign-uid files (a prior placement's uid,
 * or root-written build artifacts) and that the task user's `rm` then dies with "Operation not permitted"; it
 * clears AS ROOT. Dispose was never given the same fix, so the very tree prepare could clear, dispose could not.
 * And every caller of `disposeWorkspace` swallows errors — a failed disposal must not break the path that
 * triggered it — so the thrown failure was indistinguishable from a clean disposal and the workdir stayed on the
 * volume unnoticed.
 */
function isWorkspaceRemoval(args: readonly string[], taskId: string): boolean {
	return args[0] === "exec" && args.includes("rm") && args.includes(`/workspaces/${taskId}`);
}

/** `-u 0:0` is the root exec; a task-user exec passes the placement's own uid. */
function runsAsRoot(args: readonly string[]): boolean {
	const flag = args.indexOf("-u");
	return flag >= 0 && args[flag + 1] === "0:0";
}

function createExecFileStub(options: { failRemoval?: boolean } = {}): {
	execFile: typeof execFile;
	calls: string[][];
} {
	const calls: string[][] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push([...args]);
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (args[0] === "run") {
			done(null, { stdout: "container-id\n", stderr: "" });
			return {} as ReturnType<typeof execFile>;
		}
		if (args[0] === "inspect" && args[1] === "-f" && args[2] === "{{.State.Running}}") {
			done(null, { stdout: "true\n", stderr: "" });
			return {} as ReturnType<typeof execFile>;
		}
		if (options.failRemoval === true && args.includes("rm")) {
			done(
				Object.assign(new Error("rm failed"), {
					code: 1,
					stdout: "",
					stderr: "rm: cannot remove '/workspaces/task-1/node_modules': Operation not permitted",
				}),
			);
			return {} as ReturnType<typeof execFile>;
		}
		done(null, { stdout: "", stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return { execFile: stub as unknown as typeof execFile, calls };
}

describe("AgentSandboxManager.disposeWorkspace — removal runs as root and a leak is reported", () => {
	it("removes the workspace AS ROOT, so a foreign-uid tree is still removable", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		await manager.disposeWorkspace("task-1");

		const removal = calls.find((args) => isWorkspaceRemoval(args, "task-1"));
		expect(removal, "the disposal must remove the workspace").toBeDefined();
		expect(runsAsRoot(removal as string[])).toBe(true);
	});

	it("records the leak when the removal fails, because every caller swallows the throw", async () => {
		observations.length = 0;
		const { execFile: execFileStub } = createExecFileStub({ failRemoval: true });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		// This is exactly what the real callers do — and why a throw alone tells nobody anything.
		await manager.disposeWorkspace("task-1").catch(() => null);

		const leak = observations.find((event) => event.metadata?.category === "sandbox_workspace_removal_failed");
		expect(leak, "a failed removal must be observable, not merely thrown").toBeDefined();
		expect(leak?.severity).toBe("warning");
		expect(leak?.message).toContain("leaked on the volume");
		expect(leak?.metadata?.workdir).toBe("/workspaces/task-1");
	});

	it("still releases the slot when the removal fails — a leaked workdir is recoverable, a leaked slot is not", async () => {
		const { execFile: execFileStub } = createExecFileStub({ failRemoval: true });
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.disposeWorkspace("task-1").catch(() => null);

		// If the slot had leaked, this acquisition would never settle.
		await expect(manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" })).resolves.toBeDefined();
	});
});
