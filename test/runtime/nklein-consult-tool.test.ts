import { describe, expect, it } from "vitest";
import type { ConsultCandidate } from "../../src/core/model-consult";
import type { ConsultObservation } from "../../src/core/model-consult-visibility";
import { type ConsultToolDeps, createConsultTool } from "../../src/nklein-agent/nklein-consult-tool";

/**
 * F3.37 wire — every path of `consult_stronger_model`'s execute, with all seams injected.
 *
 * The properties that matter beyond happy-path: a DECLINE is a visible reply (never a silent no-op), a failed
 * completion does NOT spend the budget (no observation recorded — usage derives from observations), and the
 * answer always carries the ADVISORY framing (the asker verifies, never trusts).
 */

const STRONG: ConsultCandidate = { key: "k-strong", modelId: "strong-30b", capability: 70, loadedAndIdle: true };

function deps(overrides: Partial<ConsultToolDeps> = {}): ConsultToolDeps & { observations: ConsultObservation[] } {
	const observations: ConsultObservation[] = [];
	return {
		taskId: "card-7",
		askerModelId: "weak-7b",
		askerCapability: 40,
		consultBudget: 1,
		countFailedAttempts: async () => 2,
		countConsultsUsed: async () => 0,
		gatherCandidates: async () => [STRONG],
		runConsultCompletion: async () => "Root cause: X. Fix: Y. If that fails: Z.",
		recordObservation: (observation) => {
			observations.push(observation);
		},
		observations,
		...overrides,
	};
}

const INPUT = {
	problem: "Test A fails with a type error I cannot resolve.",
	attempts_tried: "Widened the generic; rewrote with overloads. Both fail identically.",
	error_output: "TS2322",
	relevant_context: "function f<T>(x: T): T { … }",
};

async function run(tool: ReturnType<typeof createConsultTool>, input: unknown): Promise<Record<string, unknown>> {
	return (await tool.execute(input, undefined as never)) as Record<string, unknown>;
}

describe("createConsultTool", () => {
	it("rejects an empty problem/attempts_tried before touching any seam", async () => {
		const d = deps({
			countFailedAttempts: async () => {
				throw new Error("must not be called");
			},
		});
		const result = await run(createConsultTool(d), { problem: " ", attempts_tried: "" });
		expect(result.ok).toBe(false);
		expect(String(result.error)).toMatch(/non-empty/u);
	});

	it("declines VISIBLY when the stuck-gate is not satisfied", async () => {
		const d = deps({ countFailedAttempts: async () => 1 });
		const result = await run(createConsultTool(d), INPUT);
		expect(result.ok).toBe(false);
		expect(String(result.declined)).toMatch(/🤝 Consult declined/u);
		expect(String(result.declined)).toMatch(/stuck-gate needs 2/u);
		expect(d.observations).toHaveLength(0);
	});

	it("declines when the budget is already spent — consultation must not become the loop", async () => {
		const d = deps({ countConsultsUsed: async () => 1 });
		const result = await run(createConsultTool(d), INPUT);
		expect(result.ok).toBe(false);
		expect(String(result.declined)).toMatch(/budget spent/iu);
	});

	it("declines when no loaded+idle candidate is materially stronger", async () => {
		const d = deps({ gatherCandidates: async () => [{ ...STRONG, loadedAndIdle: false }] });
		const result = await run(createConsultTool(d), INPUT);
		expect(result.ok).toBe(false);
		expect(String(result.declined)).toMatch(/declining the consult/u);
	});

	it("declines on a failed completion WITHOUT spending the budget", async () => {
		// Usage derives from recorded observations; a transport failure records none, so the retry (if the model
		// consults again) still has its budget. The decline names the consultant and tells the asker to continue.
		const d = deps({ runConsultCompletion: async () => null });
		const result = await run(createConsultTool(d), INPUT);
		expect(result.ok).toBe(false);
		expect(String(result.declined)).toMatch(/strong-30b did not answer/u);
		expect(d.observations).toHaveLength(0);
	});

	it("returns the advisory-wrapped answer with both notices and records the observation", async () => {
		const d = deps();
		const result = await run(createConsultTool(d), INPUT);
		expect(result.ok).toBe(true);
		expect(String(result.notice)).toMatch(/🤝 Consulting stronger model strong-30b/u);
		expect(String(result.notice)).toMatch(/stuck after 2 failed attempt/u);
		expect(String(result.notice)).toMatch(/answered in .*advisory/u);
		expect(String(result.answer)).toMatch(/^\[consult answer from strong-30b — ADVISORY/u);
		expect(d.observations).toHaveLength(1);
		const observation = d.observations[0];
		expect(observation?.metadata.category).toBe("model_consult");
		expect(observation?.metadata.askerModelId).toBe("weak-7b");
		expect(observation?.metadata.consultantModelId).toBe("strong-30b");
		expect(observation?.metadata.requestBytes).toBeGreaterThan(0);
		expect(observation?.metadata.answerBytes).toBeGreaterThan(0);
		// Pending ALWAYS at emit time — whether the consult converted the card joins at analysis time (P15.3).
		expect(observation?.metadata.followUpOutcome).toBeNull();
	});

	it("re-derives admission from LIVE state on every call (session outlives registration-time facts)", async () => {
		let failed = 2;
		const d = deps({ countFailedAttempts: async () => failed });
		const tool = createConsultTool(d);
		expect((await run(tool, INPUT)).ok).toBe(true);
		failed = 0;
		const second = await run(tool, INPUT);
		expect(second.ok).toBe(false);
		expect(String(second.declined)).toMatch(/stuck-gate/u);
	});
});
