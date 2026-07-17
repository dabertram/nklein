import { describe, expect, it } from "vitest";
import { arbitrateByExecution } from "../../../src/core/execution-arbitration";

describe("arbitrateByExecution (F12.4)", () => {
	it("names the passing candidate decisively on a pass/fail split", () => {
		const verdict = arbitrateByExecution({ passed: true, failureCount: 0 }, { passed: false, failureCount: 3 });
		expect(verdict).toMatchObject({ winner: "a", decisive: true });
		expect(verdict.note).toContain("Candidate A PASSES");
		expect(
			arbitrateByExecution({ passed: false, failureCount: null }, { passed: true, failureCount: null }).winner,
		).toBe("b");
	});

	it("prefers the closer-to-green candidate when both fail with known counts", () => {
		const verdict = arbitrateByExecution({ passed: false, failureCount: 5 }, { passed: false, failureCount: 1 });
		expect(verdict).toMatchObject({ winner: "b", decisive: true });
		expect(verdict.note).toContain("1 vs 5");
	});

	it("defers to the reviewer on both-pass, equal failures, and unknown runs — honestly labeled", () => {
		expect(arbitrateByExecution({ passed: true, failureCount: 0 }, { passed: true, failureCount: 0 }).decisive).toBe(
			false,
		);
		expect(
			arbitrateByExecution({ passed: false, failureCount: 2 }, { passed: false, failureCount: 2 }).winner,
		).toBeNull();
		const unknown = arbitrateByExecution({ passed: null, failureCount: null }, { passed: true, failureCount: 0 });
		expect(unknown.decisive).toBe(false);
		expect(unknown.note).toContain("inconclusive");
	});
});
