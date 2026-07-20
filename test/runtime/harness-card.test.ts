import { describe, expect, it } from "vitest";
import { assessCardCompleteness, assessComparability, type HarnessCard } from "../../src/core/harness-card";

function card(overrides: Partial<HarnessCard> = {}): HarnessCard {
	return {
		id: "baseline",
		execution: "docker, 4 cpu, 8gb",
		tool: "read/write/bash",
		context: "32k, compact at 0.75",
		scheduling: "sequential, cap 3",
		observability: "ledger + self-observations",
		verification: "acceptance command",
		governance: "egress fence on",
		retryBudget: 2,
		...overrides,
	};
}

describe("assessComparability", () => {
	it("calls two identical configurations comparable", () => {
		expect(assessComparability(card(), card({ id: "other" })).verdict).toBe("comparable");
	});

	it("INVALIDATES — not merely confounds — a retry-budget mismatch", () => {
		// A scaffold that retries more beats one that retries less, and the gain gets credited to its architecture.
		const result = assessComparability(card(), card({ id: "other", retryBudget: 5 }));
		expect(result.verdict).toBe("invalid");
		expect(result.reason).toContain("EQUALIZE RETRIES FIRST");
	});

	it("ranks the retry mismatch ABOVE other differences", () => {
		// Even with several dimensions differing, retries is the one that invalidates rather than confounds.
		const result = assessComparability(
			card(),
			card({ id: "other", retryBudget: 5, tool: "read only", context: "8k" }),
		);
		expect(result.verdict).toBe("invalid");
		expect(result.differing).toContain("retryBudget");
	});

	it("reports CONFOUNDED with the differing dimensions named", () => {
		const result = assessComparability(card(), card({ id: "other", context: "128k, no compaction" }));
		expect(result.verdict).toBe("confounded");
		expect(result.differing).toEqual(["context"]);
	});

	it("treats confounded as usable-if-reported, not as a soft invalid", () => {
		// Sometimes the differing dimension IS the thing being tested. What is unacceptable is a difference nobody
		// names — the state most published comparisons are in.
		const result = assessComparability(card(), card({ id: "other", scheduling: "parallel, cap 8" }));
		expect(result.reason).toContain("which is fine IF the difference is what is being tested");
		expect(result.reason).toContain("7.80×");
	});

	it("ignores incidental whitespace rather than reporting a false difference", () => {
		expect(assessComparability(card(), card({ id: "other", tool: "  read/write/bash  " })).verdict).toBe(
			"comparable",
		);
	});

	it("does not treat the card id as a dimension", () => {
		expect(assessComparability(card({ id: "a" }), card({ id: "b" })).differing).toEqual([]);
	});
});

describe("assessCardCompleteness", () => {
	it("accepts a fully-declared card", () => {
		expect(assessCardCompleteness(card()).complete).toBe(true);
	});

	it("treats an empty dimension as a DEFECT, not as 'not applicable'", () => {
		// 'We did not write it down' and 'it does not apply' are different claims, and only the second is ever
		// true — every harness has an execution model and a verification method whether or not anyone described it.
		const result = assessCardCompleteness(card({ verification: "   " }));
		expect(result.complete).toBe(false);
		expect(result.missing).toEqual(["verification"]);
	});

	it("names every missing dimension, not just the first", () => {
		const result = assessCardCompleteness(card({ execution: "", governance: "" }));
		expect(result.missing).toEqual(["execution", "governance"]);
	});

	it("rejects a nonsensical retry budget", () => {
		expect(assessCardCompleteness(card({ retryBudget: -1 })).defects).toContain("negative_retry_budget");
		expect(assessCardCompleteness(card({ retryBudget: Number.NaN })).defects).toContain("negative_retry_budget");
	});
});
