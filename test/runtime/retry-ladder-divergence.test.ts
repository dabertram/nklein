import { describe, expect, it } from "vitest";
import { auditChatLadderAdoption, compareLadders, OBSERVED_CHAT_LADDERS } from "../../src/core/retry-ladder-divergence";

describe("compareLadders", () => {
	it("flags a rung chat tries that the engine's ladder omits as a LOSS", () => {
		// The real case: chat retries a bigger token budget on a no-tool-call turn, the engine only lists that rung
		// under `aborted`. Adopting would drop the cheapest live-validated recovery for the commonest failure.
		const report = compareLadders({ outcome: "no_tool_call", chatSequence: ["raise_token_budget"] });
		expect(report.safeToAdopt).toBe(false);
		expect(report.divergences.some((d) => d.kind === "missing_in_engine" && d.rung === "raise_token_budget")).toBe(
			true,
		);
		expect(report.summary).toContain("REGRESS");
	});

	it("flags thinking_disable as INEXPRESSIBLE, not merely missing", () => {
		// Distinct from `missing_in_engine`: there is nowhere to put this rung back, because the strategy union has
		// no name for it. Collapsing the two would hide that adopting requires extending the engine's vocabulary.
		const report = compareLadders({ outcome: "no_tool_call", chatSequence: ["thinking_disable"] });
		expect(report.divergences[0]?.kind).toBe("inexpressible_in_engine");
		expect(report.divergences[0]?.detail).toContain("no place to put it back");
	});

	it("flags a reorder, because the chat order is cost-ranked rather than arbitrary", () => {
		// reduced_tool_set is the engine's FIRST no_tool_call rung, so putting it first in chat cannot reorder.
		// Put it second behind a rung the engine ranks later to force the comparison.
		const report = compareLadders({
			outcome: "no_tool_call",
			chatSequence: ["constrained_schema", "reduced_tool_set"],
		});
		// constrained_schema is engine position 2, chat position 1 → engine reaches it LATER than chat.
		expect(report.divergences.some((d) => d.kind === "reordered")).toBe(true);
		expect(report.safeToAdopt).toBe(false);
	});

	it("treats an engine-only rung as a GAIN that does not block adoption", () => {
		const report = compareLadders({ outcome: "no_tool_call", chatSequence: ["reduced_tool_set"] });
		expect(report.divergences.every((d) => d.kind === "engine_only")).toBe(true);
		expect(report.safeToAdopt).toBe(true);
		expect(report.summary).toContain("loses nothing");
	});

	it("reports safe adoption when chat does nothing the engine cannot", () => {
		const report = compareLadders({ outcome: "malformed", chatSequence: ["constrained_schema"] });
		expect(report.safeToAdopt).toBe(true);
	});
});

describe("auditChatLadderAdoption", () => {
	it("reports the CURRENT state: F3.8 is NOT a safe wire yet", () => {
		// This is the finding, pinned. If someone later extends the engine so this passes, that is the signal F3.8
		// became a wire — and this test will say so by failing, which is the point.
		const audit = auditChatLadderAdoption();
		expect(audit.safeToAdopt).toBe(false);
		expect(audit.summary).toContain("F3.8 is not a wire yet");
	});

	it("names the token-budget rung as the specific blocker on the no_tool_call path", () => {
		const audit = auditChatLadderAdoption();
		const noToolCall = audit.reports.find((r) => r.outcome === "no_tool_call");
		expect(
			noToolCall?.divergences.some((d) => d.rung === "raise_token_budget" && d.kind === "missing_in_engine"),
		).toBe(true);
	});

	it("passes once the engine covers everything the ladders do", () => {
		const audit = auditChatLadderAdoption([{ outcome: "malformed", chatSequence: ["constrained_schema"] }]);
		expect(audit.safeToAdopt).toBe(true);
		expect(audit.summary).toContain("can proceed as a wire");
	});

	it("the observed ladders are non-empty — an empty table would pass while asserting nothing", () => {
		expect(OBSERVED_CHAT_LADDERS.length).toBeGreaterThan(0);
		for (const ladder of OBSERVED_CHAT_LADDERS) {
			expect(ladder.chatSequence.length).toBeGreaterThan(0);
		}
	});
});
