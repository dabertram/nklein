import { describe, expect, it } from "vitest";
import { assessRunawayBudget } from "../../../src/core/runaway-budget-stop";

describe("assessRunawayBudget (F12.40)", () => {
	it("stops on the card token ceiling with a park-with-evidence reason", () => {
		const verdict = assessRunawayBudget({ cardTokens: 500_000, cardTurns: 10, boardTokens: 600_000 });
		expect(verdict).toMatchObject({ stop: true, tripped: "card_tokens" });
		expect(verdict.reason).toContain("park with evidence");
	});

	it("stops on turn and board ceilings in precedence order", () => {
		expect(assessRunawayBudget({ cardTokens: 0, cardTurns: 120, boardTokens: 0 }).tripped).toBe("card_turns");
		expect(assessRunawayBudget({ cardTokens: 0, cardTurns: 0, boardTokens: 2_000_000 }).tripped).toBe("board_tokens");
	});

	it("never stops within ceilings, and a ≤0 cap disables that ceiling", () => {
		expect(assessRunawayBudget({ cardTokens: 499_999, cardTurns: 119, boardTokens: 1_999_999 }).stop).toBe(false);
		expect(
			assessRunawayBudget({ cardTokens: 9_999_999, cardTurns: 5, boardTokens: 0 }, { cardTokenCap: 0 }).stop,
		).toBe(false);
	});
});
