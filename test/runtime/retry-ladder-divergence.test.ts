import { describe, expect, it } from "vitest";
import { auditChatLadderAdoption, compareLadders, OBSERVED_CHAT_LADDERS } from "../../src/core/retry-ladder-divergence";

describe("compareLadders", () => {
	it("recognizes the chat budget rung now covered by the engine", () => {
		const report = compareLadders({ outcome: "no_tool_call", chatSequence: ["raise_token_budget"] });
		expect(report.safeToAdopt).toBe(true);
		expect(report.divergences.every((d) => d.kind === "engine_only")).toBe(true);
	});

	it("recognizes thinking_disable as an engine strategy", () => {
		const report = compareLadders({
			outcome: "no_tool_call",
			chatSequence: ["raise_token_budget", "thinking_disable"],
		});
		expect(report.safeToAdopt).toBe(true);
		expect(report.divergences.every((d) => d.kind === "engine_only")).toBe(true);
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
		const report = compareLadders({
			outcome: "no_tool_call",
			chatSequence: ["raise_token_budget", "thinking_disable", "reduced_tool_set"],
		});
		expect(report.divergences.every((d) => d.kind === "engine_only")).toBe(true);
		expect(report.safeToAdopt).toBe(true);
		expect(report.summary).toContain("loses nothing");
	});

	it("does not mistake an interleaved engine-only rung for a reorder of shared rungs", () => {
		const report = compareLadders({
			outcome: "aborted",
			chatSequence: ["raise_token_budget", "same_model_retry"],
		});
		expect(report.safeToAdopt).toBe(true);
		expect(report.divergences).toContainEqual(
			expect.objectContaining({ kind: "engine_only", rung: "thinking_disable" }),
		);
		expect(report.divergences.some((divergence) => divergence.kind === "reordered")).toBe(false);
	});

	it("reports safe adoption when chat does nothing the engine cannot", () => {
		const report = compareLadders({ outcome: "malformed", chatSequence: ["constrained_schema"] });
		expect(report.safeToAdopt).toBe(true);
	});
});

describe("auditChatLadderAdoption", () => {
	it("reports the current state: the engine now preserves every observed chat rung", () => {
		const audit = auditChatLadderAdoption();
		expect(audit.safeToAdopt).toBe(true);
		expect(audit.summary).toContain("can proceed as a wire");
	});

	it("reports no blocking divergence on the no_tool_call path", () => {
		const audit = auditChatLadderAdoption();
		const noToolCall = audit.reports.find((r) => r.outcome === "no_tool_call");
		expect(noToolCall?.safeToAdopt).toBe(true);
		expect(noToolCall?.divergences.every((d) => d.kind === "engine_only")).toBe(true);
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
