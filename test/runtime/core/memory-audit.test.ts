import { describe, expect, it } from "vitest";
import {
	auditMemoryNote,
	chooseMemoryAuditor,
	type MemoryAuditSignals,
	recallWeightForVerdict,
} from "../../../src/core/memory-audit";
import type { RoleModelCandidate } from "../../../src/core/role-model-selection";

const clean: MemoryAuditSignals = {
	resolvedSymbols: [],
	unresolvedSymbols: [],
	ledgerContradictions: [],
	internalContradictions: [],
};

function candidate(modelKey: string, capability: number, over: Partial<RoleModelCandidate> = {}): RoleModelCandidate {
	return { modelKey, capability, contextWindow: 128_000, predictedWallTimeMs: null, isFree: true, ...over };
}

describe("auditMemoryNote", () => {
	it("confirms a note whose structural claims resolve and nothing contradicts", () => {
		const r = auditMemoryNote({ ...clean, resolvedSymbols: ["pkg.Foo", "pkg.bar"] });
		expect(r.verdict).toBe("confirmed");
		expect(r.recallWeight).toBe(1);
	});

	it("contradicts a note that references a symbol the code-graph cannot find", () => {
		const r = auditMemoryNote({ ...clean, resolvedSymbols: ["pkg.Foo"], unresolvedSymbols: ["pkg.Ghost"] });
		expect(r.verdict).toBe("contradicted");
		expect(r.recallWeight).toBe(0);
		expect(r.reason).toContain("not found in the code-graph");
	});

	it("contradicts a note the ledger disproves, even with resolving symbols", () => {
		const r = auditMemoryNote({ ...clean, resolvedSymbols: ["pkg.Foo"], ledgerContradictions: ["claimed X passed"] });
		expect(r.verdict).toBe("contradicted");
		expect(r.reason).toContain("contradicted by the ledger");
	});

	it("contradicts on an internal contradiction", () => {
		expect(auditMemoryNote({ ...clean, internalContradictions: ["A and not-A"] }).verdict).toBe("contradicted");
	});

	it("marks a note with no checkable structural claim as unverifiable (kept but de-weighted)", () => {
		const r = auditMemoryNote(clean);
		expect(r.verdict).toBe("unverifiable");
		expect(r.recallWeight).toBe(0.3);
	});

	it("a contradiction dominates even when some symbols resolve (fail-closed)", () => {
		const r = auditMemoryNote({
			...clean,
			resolvedSymbols: ["a", "b", "c"],
			unresolvedSymbols: ["ghost"],
		});
		expect(r.verdict).toBe("contradicted");
	});
});

describe("recallWeightForVerdict", () => {
	it("orders trust confirmed > unverifiable > contradicted", () => {
		expect(recallWeightForVerdict("confirmed")).toBeGreaterThan(recallWeightForVerdict("unverifiable"));
		expect(recallWeightForVerdict("unverifiable")).toBeGreaterThan(recallWeightForVerdict("contradicted"));
		expect(recallWeightForVerdict("contradicted")).toBe(0);
	});
});

describe("chooseMemoryAuditor", () => {
	it("picks the STRONGEST eligible model", () => {
		const auditor = chooseMemoryAuditor({
			candidates: [candidate("small", 40), candidate("big", 90), candidate("mid", 65)],
			requiredContextTokens: 32_000,
		});
		expect(auditor).toBe("big");
	});

	it("never picks the note's own author (anti-anchoring)", () => {
		const auditor = chooseMemoryAuditor({
			candidates: [candidate("author", 95), candidate("other", 70)],
			authorModelKey: "author",
			requiredContextTokens: 32_000,
		});
		expect(auditor).toBe("other");
	});

	it("returns null when the only candidate is the author", () => {
		expect(
			chooseMemoryAuditor({
				candidates: [candidate("solo", 95)],
				authorModelKey: "solo",
				requiredContextTokens: 32_000,
			}),
		).toBeNull();
	});

	it("returns null when no eligible model clears the context floor", () => {
		const auditor = chooseMemoryAuditor({
			candidates: [candidate("tiny-ctx", 90, { contextWindow: 8_000 })],
			requiredContextTokens: 32_000,
		});
		expect(auditor).toBeNull();
	});
});
