import type { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const observations: Array<{ taskId?: string | null; metadata?: Record<string, unknown> }> = [];
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: (event: { taskId?: string | null; metadata?: Record<string, unknown> }) => {
		observations.push(event);
	},
	readSelfObservationEvents: async () => [],
}));

import { AgentSandboxManager, AgentSandboxUnavailableError } from "../../../src/nklein-agent/nklein-agent-sandbox";

/**
 * P1.STARTHANG2 (a): a `prepareWorkspace` that never settles must FAIL its caller at the provisioning deadline.
 *
 * Live 2026-09-10/13: provisioning stopped after bringing up the egress proxy and the start promise never settled,
 * so the single-flight start claim was held for the runtime's lifetime, the board issued nothing, and only a
 * runtime restart cleared it. Every step inside a preparation is docker-bounded; the preparation as a whole was
 * not. These cases drive the hang shape with a docker stub whose clone never calls back.
 */
function createExecFileStub(options: { hangClone: boolean }): { execFile: typeof execFile; calls: string[][] } {
	const calls: string[][] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push([...args]);
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		if (options.hangClone && args[0] === "exec" && args.includes("clone")) {
			// The hang: the callback is never invoked, exactly like a docker exec that never returns.
			return {} as ReturnType<typeof execFile>;
		}
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

describe("AgentSandboxManager.prepareWorkspace — the provisioning deadline (P1.STARTHANG2 a)", () => {
	it("fails a preparation that has not settled by the deadline and records the pool's state", async () => {
		observations.length = 0;
		const { execFile: execFileStub } = createExecFileStub({ hangClone: true });
		const warnings: string[] = [];
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			provisioningDeadlineMs: 40,
			warn: (message) => warnings.push(message),
		});

		await expect(manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" })).rejects.toThrow(
			AgentSandboxUnavailableError,
		);

		const recorded = observations.filter(
			(event) => event.metadata?.category === "sandbox_provisioning_deadline_exceeded",
		);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.taskId).toBe("task-1");
		expect(recorded[0]?.metadata).toMatchObject({ deadlineMs: 40, placements: 1, containers: 1, queued: 0 });
		expect(warnings.some((message) => message.includes("did not settle within"))).toBe(true);
	});

	it("a retry after an abandoned preparation is a fresh attempt that also fails at its deadline instead of hanging", async () => {
		observations.length = 0;
		const { execFile: execFileStub } = createExecFileStub({ hangClone: true });
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			provisioningDeadlineMs: 30,
		});

		await expect(manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" })).rejects.toThrow(
			/did not settle within/,
		);
		// The in-flight join was dropped, so this is NOT a second wait on the hung promise — and it must settle too.
		await expect(manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" })).rejects.toThrow(
			/did not settle within/,
		);
		expect(
			observations.filter((event) => event.metadata?.category === "sandbox_provisioning_deadline_exceeded"),
		).toHaveLength(2);
	});

	it("leaves a preparation that settles before the deadline untouched", async () => {
		observations.length = 0;
		const { execFile: execFileStub } = createExecFileStub({ hangClone: false });
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile: execFileStub,
			provisioningDeadlineMs: 5_000,
		});

		const workspace = await manager.prepareWorkspace({ taskId: "task-1", projectRepoPath: "/repo" });

		expect(workspace.workdir).toContain("task-1");
		expect(observations).toHaveLength(0);
	});
});
