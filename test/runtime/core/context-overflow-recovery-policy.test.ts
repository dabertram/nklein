import { describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_CONTEXT_OVERFLOW_REDRIVES,
	decideContextOverflowTerminalRecovery,
	isContextOverflowErrorTerminal,
} from "../../../src/core/context-overflow-recovery-policy";

const OVERFLOW_500 =
	"Engine protocol predict stream returned an error: {code:500, message:'Context size has been exceeded'}";

const overflowTerminal = {
	state: "awaiting_review",
	reviewReason: "error",
	errorMessage: OVERFLOW_500,
	historyCompactable: true,
	compactionRedrivesUsed: 0,
};

describe("isContextOverflowErrorTerminal", () => {
	it("is true only for an awaiting_review/error terminal carrying an overflow message", () => {
		expect(isContextOverflowErrorTerminal(overflowTerminal)).toBe(true);
		expect(isContextOverflowErrorTerminal({ ...overflowTerminal, reviewReason: "hook" })).toBe(false);
		expect(isContextOverflowErrorTerminal({ ...overflowTerminal, reviewReason: "attention" })).toBe(false);
		expect(isContextOverflowErrorTerminal({ ...overflowTerminal, state: "running" })).toBe(false);
		expect(isContextOverflowErrorTerminal({ ...overflowTerminal, state: "failed" })).toBe(false);
		expect(isContextOverflowErrorTerminal({ ...overflowTerminal, errorMessage: "Docker bind mount failed" })).toBe(
			false,
		);
		expect(isContextOverflowErrorTerminal({ ...overflowTerminal, errorMessage: null })).toBe(false);
	});
});

describe("decideContextOverflowTerminalRecovery", () => {
	it("compacts and re-drives on the same model first (the cheapest, self-described remedy)", () => {
		const decision = decideContextOverflowTerminalRecovery(overflowTerminal);
		expect(decision.action).toBe("compact_and_redrive");
		expect(decision.reason).toContain("re-drive 1/2");
	});

	it("is `none` for every non-overflow terminal so ordinary terminal handling proceeds", () => {
		for (const terminal of [
			{ ...overflowTerminal, reviewReason: "hook" },
			{ ...overflowTerminal, errorMessage: "Engine protocol predict request returned 500: model has crashed" },
			{ ...overflowTerminal, errorMessage: "" },
			{ ...overflowTerminal, state: "interrupted", reviewReason: "interrupted" },
		]) {
			expect(decideContextOverflowTerminalRecovery(terminal).action).toBe("none");
		}
	});

	it("defers to model failover when the persisted history cannot shrink any further", () => {
		const decision = decideContextOverflowTerminalRecovery({ ...overflowTerminal, historyCompactable: false });
		expect(decision.action).toBe("defer_to_model_failover");
		expect(decision.reason).toContain("cannot be compacted");
	});

	it("defers to model failover once the consecutive re-drive budget is spent (default 2)", () => {
		expect(DEFAULT_MAX_CONTEXT_OVERFLOW_REDRIVES).toBe(2);
		expect(decideContextOverflowTerminalRecovery({ ...overflowTerminal, compactionRedrivesUsed: 1 }).action).toBe(
			"compact_and_redrive",
		);
		const spent = decideContextOverflowTerminalRecovery({ ...overflowTerminal, compactionRedrivesUsed: 2 });
		expect(spent.action).toBe("defer_to_model_failover");
		expect(spent.reason).toContain("2/2");
	});

	it("checks the budget BEFORE compactability, so a spent budget never re-drives even a shrinkable history", () => {
		const decision = decideContextOverflowTerminalRecovery({
			...overflowTerminal,
			compactionRedrivesUsed: 5,
			historyCompactable: true,
		});
		expect(decision.action).toBe("defer_to_model_failover");
	});

	it("honors a custom cap, clamping nonsense to a non-negative integer", () => {
		expect(decideContextOverflowTerminalRecovery({ ...overflowTerminal, maxCompactionRedrives: 0 }).action).toBe(
			"defer_to_model_failover",
		);
		expect(
			decideContextOverflowTerminalRecovery({
				...overflowTerminal,
				compactionRedrivesUsed: 3,
				maxCompactionRedrives: 4,
			}).action,
		).toBe("compact_and_redrive");
		expect(decideContextOverflowTerminalRecovery({ ...overflowTerminal, maxCompactionRedrives: -1 }).action).toBe(
			"defer_to_model_failover",
		);
	});
});
