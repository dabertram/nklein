import { afterEach, describe, expect, it } from "vitest";
import {
	forgetPropertyCheckEvidence,
	getPropertyCheckEvidence,
	storePropertyCheckEvidence,
} from "../../../src/nklein-agent/nklein-property-evidence-registry";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * The per-card parking spot for a property check's evidence. Its whole value is a three-way outcome that must
 * not flatten: `pass`, `fail`, and `unavailable` — plus the fourth state of no evidence at all.
 *
 * `unavailable` is the one that earns the tests. It means the check could not run, and a consumer that treats it
 * as a pass has substituted a green signal for a fact nobody established; one that treats it as a fail invents a
 * defect. Neither is recoverable downstream, because by then the distinction is gone. The `invariantCount`
 * carried alongside is what stops "0 invariants, all passed" from reading like a meaningful pass.
 */
afterEach(() => {
	for (const taskId of ["t1", "t2"]) {
		forgetPropertyCheckEvidence(taskId);
	}
});

describe("the outcomes stay distinct", () => {
	it("returns NULL when no check has been recorded", () => {
		expect(getPropertyCheckEvidence("t1")).toBeNull();
	});

	it("round-trips each of the three outcomes unchanged", () => {
		for (const outcome of ["pass", "fail", "unavailable"] as const) {
			storePropertyCheckEvidence("t1", { outcome, reason: `because ${outcome}`, invariantCount: 3 });
			expect(getPropertyCheckEvidence("t1")).toEqual({
				outcome,
				reason: `because ${outcome}`,
				invariantCount: 3,
			});
		}
	});

	it("does not let UNAVAILABLE arrive looking like a pass", () => {
		// The green-signal case. A check that could not run is not a check that passed, and the difference has to
		// survive the round trip because nothing downstream can reconstruct it.
		storePropertyCheckEvidence("t1", {
			outcome: "unavailable",
			reason: "no invariants derivable",
			invariantCount: 0,
		});

		const evidence = getPropertyCheckEvidence("t1");
		expect(evidence?.outcome).toBe("unavailable");
		expect(evidence?.outcome).not.toBe("pass");
	});

	it("carries the invariant COUNT, so a vacuous pass is visible as vacuous", () => {
		// "passed" over zero invariants is not evidence of anything. Keeping the count is what lets a reader see
		// that — the outcome alone cannot.
		storePropertyCheckEvidence("t1", { outcome: "pass", reason: "nothing to check", invariantCount: 0 });
		storePropertyCheckEvidence("t2", { outcome: "pass", reason: "all held", invariantCount: 12 });

		expect(getPropertyCheckEvidence("t1")?.invariantCount).toBe(0);
		expect(getPropertyCheckEvidence("t2")?.invariantCount).toBe(12);
	});

	it("preserves the REASON verbatim", () => {
		// The reason is the only part a human reads when the outcome is disputed; a summarised or dropped reason
		// leaves a verdict with no way to check it.
		const reason = "sandbox exited 137 before any invariant ran";
		storePropertyCheckEvidence("t1", { outcome: "unavailable", reason, invariantCount: 4 });

		expect(getPropertyCheckEvidence("t1")?.reason).toBe(reason);
	});
});

describe("keying and lifetime", () => {
	it("does not let one card's evidence answer for another", () => {
		storePropertyCheckEvidence("t1", { outcome: "pass", reason: "ok", invariantCount: 1 });

		expect(getPropertyCheckEvidence("t2")).toBeNull();
	});

	it("lets a re-check replace the earlier evidence", () => {
		storePropertyCheckEvidence("t1", { outcome: "fail", reason: "first", invariantCount: 1 });
		storePropertyCheckEvidence("t1", { outcome: "pass", reason: "after the fix", invariantCount: 1 });

		expect(getPropertyCheckEvidence("t1")?.outcome).toBe("pass");
	});

	it("forgets a card's evidence back to absence, not to a stale outcome", () => {
		storePropertyCheckEvidence("t1", { outcome: "pass", reason: "ok", invariantCount: 1 });
		forgetPropertyCheckEvidence("t1");

		expect(getPropertyCheckEvidence("t1")).toBeNull();
	});

	it("forgets only the card asked for, and is silent on an unknown one", () => {
		storePropertyCheckEvidence("t1", { outcome: "pass", reason: "ok", invariantCount: 1 });
		storePropertyCheckEvidence("t2", { outcome: "fail", reason: "no", invariantCount: 2 });
		forgetPropertyCheckEvidence("t1");
		expect(() => forgetPropertyCheckEvidence("never-checked")).not.toThrow();

		expect(getPropertyCheckEvidence("t1")).toBeNull();
		expect(getPropertyCheckEvidence("t2")?.outcome).toBe("fail");
	});
});
