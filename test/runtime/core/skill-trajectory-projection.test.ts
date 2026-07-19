import { describe, expect, it } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { buildSkillTrajectoryPairs } from "../../../src/core/skill-trajectory-projection";

const attempt = (over: {
	attemptId: string;
	outcome?: "success" | "timeout";
	role?: string;
	surfacedSkillIds?: string[];
	startedAt?: number;
	completedAt?: number;
}) =>
	buildAttemptEvent({
		eventId: over.attemptId,
		recordedAt: 1_000,
		workflowId: "wf",
		taskId: `task-${over.attemptId}`,
		workspacePathHash: "h",
		role: over.role ?? "worker",
		attemptId: over.attemptId,
		modelId: "m",
		outcome: over.outcome ?? "success",
		surfacedSkillIds: over.surfacedSkillIds ?? [],
		startedAt: over.startedAt ?? null,
		completedAt: over.completedAt ?? null,
	});

describe("F12.30 skill-trajectory pairing projection", () => {
	it("splits role-comparable attempts into with/without per surfaced skill", () => {
		const events = [
			attempt({ attemptId: "a1", surfacedSkillIds: ["s1"], startedAt: 0, completedAt: 5_000 }),
			attempt({ attemptId: "a2", surfacedSkillIds: ["s1"], outcome: "timeout" }),
			attempt({ attemptId: "a3" }),
			attempt({ attemptId: "a4", outcome: "timeout" }),
			attempt({ attemptId: "a5", role: "reviewer" }), // different role — excluded from s1's pair
		];
		const pairs = buildSkillTrajectoryPairs(events);
		expect(pairs).toHaveLength(1);
		const pair = pairs[0];
		expect(pair.skillId).toBe("s1");
		expect(pair.withSkill).toHaveLength(2);
		expect(pair.withoutSkill).toHaveLength(2);
		expect(pair.withSkill[0]).toEqual({ succeeded: true, wallMs: 5_000 });
		expect(pair.withSkill[1]).toEqual({ succeeded: false });
	});

	it("compound surfacing lands on WITH for every surfaced skill; never-surfaced skills produce no pair", () => {
		const events = [attempt({ attemptId: "b1", surfacedSkillIds: ["s1", "s2"] }), attempt({ attemptId: "b2" })];
		const pairs = buildSkillTrajectoryPairs(events);
		expect(pairs.map((pair) => pair.skillId)).toEqual(["s1", "s2"]);
		for (const pair of pairs) {
			expect(pair.withSkill).toHaveLength(1);
			expect(pair.withoutSkill).toHaveLength(1);
		}
	});

	it("no surfaced skills anywhere = no pairs; deterministic ordering by skill id", () => {
		expect(buildSkillTrajectoryPairs([attempt({ attemptId: "c1" })])).toEqual([]);
	});
});
