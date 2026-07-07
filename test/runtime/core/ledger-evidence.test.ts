import { describe, expect, it } from "vitest";
import { buildLedgerEvidence, roleEvidenceKey } from "../../../src/core/ledger-evidence";

const NUL = String.fromCharCode(0);

describe("roleEvidenceKey", () => {
	it("joins model + role with a NUL separator (must match the lookup site)", () => {
		expect(roleEvidenceKey("qwen3-8b", "worker")).toBe(`qwen3-8b${NUL}worker`);
	});

	it("the NUL separator prevents model/role boundary collisions", () => {
		// Without a separator, ("a","bc") and ("ab","c") would both be "abc"; the NUL keeps them distinct.
		expect(roleEvidenceKey("a", "bc")).not.toBe(roleEvidenceKey("ab", "c"));
	});
});

describe("buildLedgerEvidence", () => {
	it("BEST-EFFORT: a throwing ledger read yields EMPTY structures (registry capability unchanged)", async () => {
		const evidence = await buildLedgerEvidence(async () => {
			throw new Error("ledger unreadable");
		});
		expect(evidence.successByKey.size).toBe(0);
		expect(evidence.roleSuccessByKey.size).toBe(0);
		expect(evidence.verdictRuns).toEqual([]);
	});

	it("an empty ledger yields empty structures", async () => {
		const evidence = await buildLedgerEvidence(async () => []);
		expect(evidence.successByKey.size).toBe(0);
		expect(evidence.roleSuccessByKey.size).toBe(0);
		expect(evidence.verdictRuns).toEqual([]);
	});
});
