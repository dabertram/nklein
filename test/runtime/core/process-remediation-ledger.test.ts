import { describe, expect, it } from "vitest";
import {
	type AgentLedgerEvent,
	buildAttemptEvent,
	buildTransitionEvent,
} from "../../../src/core/agent-attempt-ledger.js";
import { detectProcessRemediation } from "../../../src/core/process-remediation.js";
import { buildProcessTrajectoryFromLedger } from "../../../src/core/process-remediation-ledger.js";

/** PRM ledger adapter — project a card's attempts into a trajectory the detector can run on. */

const attempt = (over: {
	taskId: string;
	role: string;
	outcome: "success" | "other_failure";
	filePaths?: string[];
	eventId: string;
}): AgentLedgerEvent =>
	buildAttemptEvent({
		workflowId: over.taskId,
		taskId: over.taskId,
		workspacePathHash: "ws",
		eventId: over.eventId,
		recordedAt: 1,
		attemptId: over.eventId,
		modelId: "m",
		role: over.role,
		outcome: over.outcome,
		toolCalls: over.filePaths
			? [{ name: "read_file", fingerprint: null, outcome: "success", filePaths: over.filePaths }]
			: [],
	});

describe("buildProcessTrajectoryFromLedger", () => {
	it("projects a task's attempts into steps (role, progress, files) and ignores other tasks/kinds", () => {
		const events: AgentLedgerEvent[] = [
			attempt({ taskId: "T1", role: "coder", outcome: "other_failure", filePaths: ["a.ts"], eventId: "e1" }),
			attempt({ taskId: "OTHER", role: "coder", outcome: "success", filePaths: ["z.ts"], eventId: "e2" }),
			attempt({ taskId: "T1", role: "reviewer", outcome: "success", filePaths: ["a.ts", "b.ts"], eventId: "e3" }),
			buildTransitionEvent({ workflowId: "T1", taskId: "T1", workspacePathHash: "ws", to: "delivery_merge" }),
		];
		const trajectory = buildProcessTrajectoryFromLedger(events, "T1");
		expect(trajectory.steps).toEqual([
			{ agent: "coder", madeProgress: false, filesRequested: ["a.ts"] },
			{ agent: "reviewer", madeProgress: true, filesRequested: ["a.ts", "b.ts"] },
		]);
	});

	it("carries plan counts through for expansion-drift, defaulting to no drift", () => {
		expect(buildProcessTrajectoryFromLedger([], "T1")).toMatchObject({
			initialPlanTaskCount: 0,
			currentPlanTaskCount: 0,
		});
		expect(buildProcessTrajectoryFromLedger([], "T1", { initial: 5, current: 9 })).toMatchObject({
			initialPlanTaskCount: 5,
			currentPlanTaskCount: 9,
		});
	});

	it("feeds context_thrash end-to-end from real attempts with growing file sets", () => {
		const events: AgentLedgerEvent[] = [
			attempt({ taskId: "T", role: "coder", outcome: "other_failure", filePaths: ["a.ts"], eventId: "e1" }),
			attempt({ taskId: "T", role: "coder", outcome: "other_failure", filePaths: ["a.ts", "b.ts"], eventId: "e2" }),
			attempt({
				taskId: "T",
				role: "coder",
				outcome: "other_failure",
				filePaths: ["a.ts", "b.ts", "c.ts"],
				eventId: "e3",
			}),
		];
		const trajectory = buildProcessTrajectoryFromLedger(events, "T");
		const findings = detectProcessRemediation(trajectory);
		expect(findings.some((f) => f.pattern === "context_thrash")).toBe(true);
	});
});
