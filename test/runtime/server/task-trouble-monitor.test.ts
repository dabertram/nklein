import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { buildAttemptProgressSnapshotsFromLedger } from "../../../src/core/agent-ledger-projections";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { buildTroubleSteeringMessage, evaluateRunningTaskTrouble } from "../../../src/server/task-trouble-monitor";

/**
 * F1.10 — the runtime's first-class stuck/at-risk read: the unified trouble verdict composed from the ledger's
 * attempt stream + the running session's activity ages, and the bounded steer message per trouble kind.
 */

const NOW = 1_000_000_000;

function attempt(input: {
	outcome: ModelOutcomeKind;
	at: number;
	tools?: string[];
	artifacts?: boolean;
	salvage?: string | null;
	promptStrategy?: string;
}): AgentLedgerEvent {
	return buildAttemptEvent({
		workflowId: "wf",
		taskId: "task-1",
		workspacePathHash: "hash",
		attemptId: `a-${input.at}`,
		modelId: "test-model",
		outcome: input.outcome,
		recordedAt: input.at,
		promptStrategy: input.promptStrategy ?? "baseline",
		toolCalls: (input.tools ?? []).map((name) => ({ name, fingerprint: null, outcome: null })),
		salvage: input.salvage ?? null,
		artifacts: input.artifacts ? { resultBranch: "nklein/tasks/task-1", patchRef: null, evidenceBundle: null } : null,
	});
}

function summary(over: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "nklein",
		workspacePath: "/tmp/ws",
		pid: 1,
		startedAt: NOW - 3_600_000,
		updatedAt: NOW,
		lastOutputAt: NOW - 10_000,
		reviewReason: null,
		exitCode: null,
		lastHookAt: NOW - 10_000,
		latestHookActivity: null,
		...over,
	};
}

describe("buildAttemptProgressSnapshotsFromLedger (F1.10 mapper)", () => {
	it("projects attempts chronologically with tool breadth and artifact presence", () => {
		const snapshots = buildAttemptProgressSnapshotsFromLedger(
			[
				attempt({ outcome: "other_failure", at: 200, tools: ["read_files", "read_files"] }),
				attempt({ outcome: "success", at: 100, tools: ["read_files", "write_file"], artifacts: true }),
			],
			"task-1",
		);
		expect(snapshots).toEqual([
			{
				outcome: "success",
				toolCallsEmitted: 2,
				distinctToolsExercised: 2,
				usableOutputBytes: 1,
			},
			{
				outcome: "other_failure",
				toolCallsEmitted: 2,
				distinctToolsExercised: 1,
				usableOutputBytes: 0,
			},
		]);
	});
});

describe("evaluateRunningTaskTrouble", () => {
	it("reports no trouble for a progressing, active run", () => {
		const verdict = evaluateRunningTaskTrouble({
			events: [attempt({ outcome: "success", at: NOW - 60_000, artifacts: true })],
			summary: summary(),
			nowMs: NOW,
		});
		expect(verdict.trouble).toBe(false);
		expect(verdict.kind).toBe("none");
	});

	it("flags a no-progress grind: repeated identical no-forward attempts", () => {
		// Four identical read-loop attempts, no artifacts, no checks — the classic grinding worker.
		const events = [1, 2, 3, 4].map((round) =>
			attempt({ outcome: "other_failure", at: NOW - 500_000 + round * 1_000, tools: ["read_files"] }),
		);
		const verdict = evaluateRunningTaskTrouble({ events, summary: summary(), nowMs: NOW });
		expect(verdict.trouble).toBe(true);
		expect(verdict.kind).toBe("no_progress");
		expect(buildTroubleSteeringMessage(verdict)).toContain("Change the approach");
	});

	it("flags hard_stuck when capability failures persist across approaches with an uncleared loop", () => {
		const events = [
			attempt({ outcome: "loop", at: NOW - 40_000, promptStrategy: "baseline", salvage: null }),
			attempt({ outcome: "timeout", at: NOW - 30_000, promptStrategy: "simplified" }),
			attempt({ outcome: "other_failure", at: NOW - 20_000, promptStrategy: "carried" }),
		];
		const verdict = evaluateRunningTaskTrouble({ events, summary: summary(), nowMs: NOW });
		expect(verdict.trouble).toBe(true);
		expect(verdict.kind).toBe("hard_stuck");
		expect(buildTroubleSteeringMessage(verdict)).toContain("do not keep grinding");
	});

	it("flags silence only for a run that already emitted output and then lost its heartbeat", () => {
		const verdict = evaluateRunningTaskTrouble({
			events: [],
			summary: summary({ lastOutputAt: NOW - 2_000_000, lastHookAt: NOW - 2_000_000 }),
			nowMs: NOW,
		});
		expect(verdict.kind).toBe("silent");
		// Silence is recorded, never messaged — the killing rungs own dead runs.
		expect(buildTroubleSteeringMessage(verdict)).toBeNull();

		// A pre-first-token session (never emitted) is the zero-token sweep's jurisdiction, not "silent".
		const preFirstToken = evaluateRunningTaskTrouble({
			events: [],
			summary: summary({ lastOutputAt: null, lastHookAt: null }),
			nowMs: NOW,
		});
		expect(preFirstToken.kind).not.toBe("silent");
	});

	it("a slow-but-beating low-power run is NOT trouble (generous thresholds)", () => {
		const verdict = evaluateRunningTaskTrouble({
			events: [],
			// 8 minutes since last output — idle-ish but under the 10-minute stall and 20-minute silence bounds.
			summary: summary({ lastOutputAt: NOW - 480_000, lastHookAt: NOW - 480_000 }),
			nowMs: NOW,
		});
		expect(verdict.trouble).toBe(false);
	});
});
