import { describe, expect, it } from "vitest";
import { recommendEscalationAction } from "../../../src/core/escalation-suggestions";

describe("recommendEscalationAction (F12.59)", () => {
	it("leads with the blocked action at high confidence when one is provably pending", () => {
		const recommendation = recommendEscalationAction({ blockedActionPending: true });
		expect(recommendation.recommended.kind).toBe("approve_blocked_action");
		expect(recommendation.confidence).toBe("high");
		expect(recommendation.rationale).toContain("IS the unblock");
		expect(recommendation.alternatives.map((entry) => entry.kind)).not.toContain("approve_blocked_action");
	});

	it("leads with the clarify answer at high confidence when a question is pending", () => {
		const recommendation = recommendEscalationAction({ clarifyPending: true });
		expect(recommendation.recommended.kind).toBe("clarify_ambiguity");
		expect(recommendation.confidence).toBe("high");
	});

	it("reads environment blockers at medium and no-signal at an honestly-labeled low", () => {
		expect(recommendEscalationAction({ environmentBlocked: true }).confidence).toBe("medium");
		const generic = recommendEscalationAction({});
		expect(generic.confidence).toBe("low");
		expect(generic.rationale).toContain("not a diagnosis");
		// The full option set survives: recommendation + alternatives = the ordered suggestions.
		expect(1 + generic.alternatives.length).toBeGreaterThanOrEqual(7);
	});
});
