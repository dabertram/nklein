import type { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: () => undefined,
	readSelfObservationEvents: async () => [],
}));

import { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";

/**
 * P0.AUDIT0904 leg 18: concurrent same-task `prepareWorkspace` calls share ONE preparation.
 *
 * The workspace lifecycle lock serializes prepare against dispose so neither deletes `/workspaces/<task>` under
 * the other's cwd. Serialized is not deduplicated: two callers that both wanted the workspace ready — a start
 * racing a redrive, a re-check racing a bounce — each ran a full destructive prepare, and the second one's
 * `rm -rf` took out the tree the first had already handed to a live session. Ordering made that orderly, not safe.
 *
 * The fix joins the in-flight preparation, and only the CONCURRENT case: a prepare that starts after the previous
 * one settled still re-clones, because start / review-at-result / acceptance-at-result all rely on a fresh clone.
 */
function isCloneOf(args: readonly string[], taskId: string): boolean {
	return args[0] === "exec" && args.includes("clone") && args.some((part) => part.includes(`/workspaces/${taskId}`));
}

function createExecFileStub(): { execFile: typeof execFile; calls: string[][] } {
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
		done(null, { stdout: "", stderr: "" });
		return {} as ReturnType<typeof execFile>;
	});
	return { execFile: stub as unknown as typeof execFile, calls };
}

describe("AgentSandboxManager.prepareWorkspace — concurrent callers share one preparation", () => {
	it("clones ONCE for two concurrent same-task prepares, and both get the same workspace", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		const [first, second] = await Promise.all([
			manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" }),
			manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" }),
		]);

		expect(second).toEqual(first);
		expect(calls.filter((args) => isCloneOf(args, "task-1"))).toHaveLength(1);
	});

	it("does not join two DIFFERENT tasks — they are unrelated workspaces", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await Promise.all([
			manager.prepareWorkspace({ taskId: "task-a", projectRepoPath: "/repo" }),
			manager.prepareWorkspace({ taskId: "task-b", projectRepoPath: "/repo" }),
		]);

		expect(calls.filter((args) => isCloneOf(args, "task-a"))).toHaveLength(1);
		expect(calls.filter((args) => isCloneOf(args, "task-b"))).toHaveLength(1);
	});

	it("still re-clones for a prepare that starts AFTER the previous one settled", async () => {
		const { execFile: execFileStub, calls } = createExecFileStub();
		const manager = new AgentSandboxManager({ image: "test-image", execFile: execFileStub });

		await manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" });

		// Sequential prepares are the fresh-clone path every caller relies on; only the concurrent case is joined.
		expect(calls.filter((args) => isCloneOf(args, "task-1"))).toHaveLength(2);
	});
});
