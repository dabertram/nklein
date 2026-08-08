import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * The acceptance seam that turns a sandbox verdict into execution-level skill evidence: for every procedural
 * skill SURFACED into a task's session, record validated (acceptance green) or refuted (red). It feeds the
 * F12.29 promotion gate, which is why the writes have to be exact — this evidence is what decides whether a
 * skill gets promoted or dropped, so a skill credited for a card it never touched is a skill promoted on
 * someone else's success.
 *
 * The contract is best-effort: any failure resolves silently, because skill bookkeeping must never block the
 * review flow. That guarantee is easy to state and easy to lose (one un-awaited throw), and impossible to
 * observe from the outside — a swallowed failure and a successful no-op look identical. So it is pinned per
 * failing dependency, each with the WRITE also asserted absent.
 */
const ledger = vi.hoisted(() => ({ readAgentLedger: vi.fn(), hashWorkspacePathForLedger: vi.fn(() => "hash") }));
const store = vi.hoisted(() => ({ getCurrentProceduralSkills: vi.fn(), upsertProceduralSkill: vi.fn() }));
const record = vi.hoisted(() => ({ recordProceduralSkillExecutionOutcome: vi.fn() }));

vi.mock("../../../src/state/agent-attempt-ledger-store", () => ({ readAgentLedger: ledger.readAgentLedger }));
vi.mock("../../../src/nklein-agent/nklein-ledger-attempt", () => ({
	hashWorkspacePathForLedger: ledger.hashWorkspacePathForLedger,
}));
vi.mock("../../../src/state/procedural-skill-store", () => store);
vi.mock("../../../src/core/procedural-skill-record", () => record);

const { recordExecutionOutcomeForTaskSkills } = await import(
	"../../../src/nklein-agent/procedural-skill-execution-recorder"
);

const attempt = (taskId: string, surfacedSkillIds?: string[]) => ({ kind: "attempt", taskId, surfacedSkillIds });
const skill = (id: string) => ({ id, name: id });

beforeEach(() => {
	vi.clearAllMocks();
	ledger.hashWorkspacePathForLedger.mockReturnValue("hash");
	ledger.readAgentLedger.mockResolvedValue([attempt("t1", ["skill-a"])]);
	store.getCurrentProceduralSkills.mockResolvedValue([skill("skill-a"), skill("skill-b")]);
	record.recordProceduralSkillExecutionOutcome.mockImplementation((existing, passed) => ({ ...existing, passed }));
	store.upsertProceduralSkill.mockResolvedValue(undefined);
});

describe("which skills get the evidence", () => {
	it("records the verdict against every skill surfaced into the session", async () => {
		ledger.readAgentLedger.mockResolvedValue([attempt("t1", ["skill-a", "skill-b"])]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.upsertProceduralSkill).toHaveBeenCalledTimes(2);
		expect(record.recordProceduralSkillExecutionOutcome).toHaveBeenCalledWith(
			expect.objectContaining({ id: "skill-a" }),
			true,
			expect.any(Number),
		);
	});

	it("passes a RED acceptance through as a refutation, not as nothing", async () => {
		// Both verdicts are evidence. Recording only the greens would promote on wins while never counting losses.
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: false });

		expect(record.recordProceduralSkillExecutionOutcome).toHaveBeenCalledWith(
			expect.anything(),
			false,
			expect.any(Number),
		);
	});

	it("uses the LATEST attempt's surfaced skills, not the first", async () => {
		// A card that was re-worked surfaced a different skill set the second time; crediting the first attempt's
		// skills would attribute this acceptance run to skills that were not in the session that produced it.
		ledger.readAgentLedger.mockResolvedValue([attempt("t1", ["stale"]), attempt("t1", ["skill-a"])]);
		store.getCurrentProceduralSkills.mockResolvedValue([skill("stale"), skill("skill-a")]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(record.recordProceduralSkillExecutionOutcome).toHaveBeenCalledTimes(1);
		expect(record.recordProceduralSkillExecutionOutcome).toHaveBeenCalledWith(
			expect.objectContaining({ id: "skill-a" }),
			true,
			expect.any(Number),
		);
	});

	it("ignores attempts belonging to OTHER cards", async () => {
		// The ledger is per workspace, not per card. Without the task filter, one card's acceptance would credit
		// every skill any card in the workspace had surfaced.
		ledger.readAgentLedger.mockResolvedValue([attempt("other-card", ["skill-b"]), attempt("t1", ["skill-a"])]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.upsertProceduralSkill).toHaveBeenCalledTimes(1);
		expect(record.recordProceduralSkillExecutionOutcome).toHaveBeenCalledWith(
			expect.objectContaining({ id: "skill-a" }),
			true,
			expect.any(Number),
		);
	});

	it("ignores non-attempt ledger events", async () => {
		ledger.readAgentLedger.mockResolvedValue([{ kind: "review", taskId: "t1", surfacedSkillIds: ["skill-a"] }]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.upsertProceduralSkill).not.toHaveBeenCalled();
	});

	it("skips a surfaced id that no longer names a known skill", async () => {
		// Skills can be deleted between a session and its review; a missing one is skipped and the rest still get
		// their evidence, rather than the whole recording being lost to one stale id.
		ledger.readAgentLedger.mockResolvedValue([attempt("t1", ["deleted-skill", "skill-b"])]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.upsertProceduralSkill).toHaveBeenCalledTimes(1);
		expect(record.recordProceduralSkillExecutionOutcome).toHaveBeenCalledWith(
			expect.objectContaining({ id: "skill-b" }),
			true,
			expect.any(Number),
		);
	});
});

describe("when there is nothing to record", () => {
	it("writes nothing when the attempt surfaced no skills", async () => {
		ledger.readAgentLedger.mockResolvedValue([attempt("t1", [])]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.getCurrentProceduralSkills).not.toHaveBeenCalled();
		expect(store.upsertProceduralSkill).not.toHaveBeenCalled();
	});

	it("writes nothing when the attempt has no surfacedSkillIds stamp at all", async () => {
		// Older attempts predate the stamp; treating a missing field as an error, or as "all skills", would either
		// break the seam or credit every skill in the store.
		ledger.readAgentLedger.mockResolvedValue([attempt("t1", undefined)]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.upsertProceduralSkill).not.toHaveBeenCalled();
	});

	it("writes nothing when the ledger holds no attempts for this card", async () => {
		ledger.readAgentLedger.mockResolvedValue([]);
		await recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true });

		expect(store.upsertProceduralSkill).not.toHaveBeenCalled();
	});
});

describe("best-effort by contract", () => {
	it("resolves silently when the LEDGER read fails, writing nothing", async () => {
		// Pinned per dependency because a swallowed failure and a successful no-op are indistinguishable from the
		// outside — asserting only "it did not throw" would pass against a module that had stopped working.
		ledger.readAgentLedger.mockRejectedValue(new Error("ledger unreadable"));

		await expect(
			recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true }),
		).resolves.toBeUndefined();
		expect(store.upsertProceduralSkill).not.toHaveBeenCalled();
	});

	it("resolves silently when the skill STORE read fails", async () => {
		store.getCurrentProceduralSkills.mockRejectedValue(new Error("store unreadable"));

		await expect(
			recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true }),
		).resolves.toBeUndefined();
		expect(store.upsertProceduralSkill).not.toHaveBeenCalled();
	});

	it("resolves silently when a skill WRITE fails mid-way", async () => {
		// The one that would otherwise reach the review flow: the failure happens after the seam has committed to
		// writing, so an unguarded rejection here surfaces as a failed review rather than as absent bookkeeping.
		ledger.readAgentLedger.mockResolvedValue([attempt("t1", ["skill-a", "skill-b"])]);
		store.upsertProceduralSkill.mockRejectedValueOnce(new Error("disk full"));

		await expect(
			recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: "/w", passed: true }),
		).resolves.toBeUndefined();
	});

	it("resolves silently for a null workspace path", async () => {
		await expect(
			recordExecutionOutcomeForTaskSkills({ taskId: "t1", workspacePath: null, passed: true }),
		).resolves.toBeUndefined();
		expect(ledger.hashWorkspacePathForLedger).toHaveBeenCalledWith(null);
	});
});
