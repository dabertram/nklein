import { describe, expect, it, vi } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { runSkillAuditSweep } from "../../../src/core/procedural-skill-audit-sweep";
import {
	createProceduralSkill,
	recordProceduralSkillExecutionOutcome,
} from "../../../src/core/procedural-skill-record";

const attempt = (id: string, outcome: "success" | "timeout", skillIds: string[] = []) =>
	buildAttemptEvent({
		eventId: id,
		recordedAt: 1_000,
		workflowId: "wf",
		taskId: `task-${id}`,
		workspacePathHash: "h",
		role: "worker",
		attemptId: id,
		modelId: "m",
		outcome,
		surfacedSkillIds: skillIds,
	});

const candidate = (id: string) =>
	createProceduralSkill({
		id,
		title: id,
		content: "steps here",
		contentHash: "h",
		provenance: { source: "learned", trust: "local", capturedAt: 1 },
		now: 1,
	});

// s1 wins clearly with the skill (3/3 vs 0/3 without).
const winningLedger = [
	attempt("a1", "success", ["s1"]),
	attempt("a2", "success", ["s1"]),
	attempt("a3", "success", ["s1"]),
	attempt("b1", "timeout"),
	attempt("b2", "timeout"),
	attempt("b3", "timeout"),
];

describe("F12.30 lifecycle sweep", () => {
	it("promotes a candidate ONLY when the audit says promote AND execution validated it", async () => {
		const validated = recordProceduralSkillExecutionOutcome(candidate("s1"), true, 2);
		const saved: unknown[] = [];
		const result = await runSkillAuditSweep({
			readAttempts: async () => winningLedger,
			loadSkills: async () => [validated],
			saveSkill: async (skill) => {
				saved.push(skill);
			},
			now: () => 99,
			apply: true,
		});
		expect(result.applied).toHaveLength(1);
		expect(result.applied[0]).toMatchObject({ skillId: "s1", from: "candidate", to: "active" });
		expect(result.blockedByExecutionGate).toEqual([]);
		expect(saved).toHaveLength(1);
	});

	it("blocks promotion without execution validation, and report-only mode never persists", async () => {
		const unvalidated = candidate("s1");
		const saveSkill = vi.fn(async () => {});
		const blocked = await runSkillAuditSweep({
			readAttempts: async () => winningLedger,
			loadSkills: async () => [unvalidated],
			saveSkill,
			now: () => 99,
			apply: true,
		});
		expect(blocked.applied).toEqual([]);
		expect(blocked.blockedByExecutionGate).toEqual(["s1"]);

		const reportOnly = await runSkillAuditSweep({
			readAttempts: async () => winningLedger,
			loadSkills: async () => [unvalidated],
			saveSkill,
			now: () => 99,
			apply: false,
		});
		expect(reportOnly.verdicts[0].action).toBe("promote");
		expect(saveSkill).not.toHaveBeenCalled();
	});

	it("retire deprecates a misleading skill from any non-deprecated status", async () => {
		const losingLedger = [
			attempt("a1", "timeout", ["s1"]),
			attempt("a2", "timeout", ["s1"]),
			attempt("a3", "timeout", ["s1"]),
			attempt("b1", "success"),
			attempt("b2", "success"),
			attempt("b3", "success"),
		];
		const active = { ...candidate("s1"), status: "active" as const };
		const saved: { status: string }[] = [];
		const result = await runSkillAuditSweep({
			readAttempts: async () => losingLedger,
			loadSkills: async () => [active],
			saveSkill: async (skill) => {
				saved.push(skill);
			},
			now: () => 99,
			apply: true,
		});
		expect(result.applied[0]).toMatchObject({ from: "active", to: "deprecated", verdict: "retire" });
		expect(saved[0].status).toBe("deprecated");
	});
});
