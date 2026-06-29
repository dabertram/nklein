import { describe, expect, it } from "vitest";
import { type RetrievedEvidence, retrievedEvidenceSchema, verifyCitations } from "../../../src/core/retrieved-evidence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<RetrievedEvidence> = {}): RetrievedEvidence {
	return {
		url: "https://example.com/page",
		sourceType: "web",
		fetchedAt: "2026-06-29T00:00:00Z",
		contentHash: "abc123def456",
		trustTier: "untrusted",
		extractionSpans: [{ start: 0, end: 100 }],
		citationIds: ["ev-1"],
		promptInjectionRiskFlags: [],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Schema: happy path
// ---------------------------------------------------------------------------

describe("retrievedEvidenceSchema — valid objects", () => {
	it("parses a minimal valid web evidence object", () => {
		const raw = {
			url: "https://docs.example.com/api",
			sourceType: "web",
			fetchedAt: "2026-06-29T12:00:00Z",
			contentHash: "deadbeef0000",
			trustTier: "untrusted",
			extractionSpans: [{ start: 10, end: 250 }],
			citationIds: ["cite-a"],
			promptInjectionRiskFlags: ["embedded-instruction"],
		};
		const result = retrievedEvidenceSchema.parse(raw);
		expect(result.sourceType).toBe("web");
		expect(result.trustTier).toBe("untrusted");
		expect(result.extractionSpans).toHaveLength(1);
		expect(result.promptInjectionRiskFlags).toEqual(["embedded-instruction"]);
	});

	it("parses a full evidence object with all optional fields", () => {
		const raw = {
			url: "https://blog.example.com/post",
			fileRef: undefined,
			title: "Blog Post Title",
			sourceType: "doc",
			author: "Jane Doe",
			publishedDate: "2025-01-15",
			fetchedAt: "2026-06-29T08:30:00Z",
			contentHash: "cafebabe1234",
			trustTier: "trusted",
			freshnessVerdict: "fresh",
			extractionSpans: [
				{ start: 0, end: 50 },
				{ start: 200, end: 400 },
			],
			citationIds: ["cite-1", "cite-2"],
			promptInjectionRiskFlags: [],
		};
		const result = retrievedEvidenceSchema.parse(raw);
		expect(result.freshnessVerdict).toBe("fresh");
		expect(result.citationIds).toEqual(["cite-1", "cite-2"]);
		expect(result.extractionSpans).toHaveLength(2);
	});

	it("allows a repo evidence object with community trust and no spans", () => {
		const raw = {
			fileRef: "src/utils/parse.ts",
			sourceType: "repo",
			fetchedAt: "2026-06-29T10:00:00Z",
			contentHash: "11223344aabb",
			trustTier: "community",
			extractionSpans: [],
			citationIds: [],
			promptInjectionRiskFlags: [],
		};
		const result = retrievedEvidenceSchema.parse(raw);
		expect(result.sourceType).toBe("repo");
		expect(result.trustTier).toBe("community");
		expect(result.extractionSpans).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Schema: rejection cases
// ---------------------------------------------------------------------------

describe("retrievedEvidenceSchema — invalid objects", () => {
	it("rejects an object missing contentHash", () => {
		const bad = {
			url: "https://example.com",
			sourceType: "web",
			fetchedAt: "2026-06-29T00:00:00Z",
			// contentHash intentionally omitted
			trustTier: "untrusted",
			extractionSpans: [],
			citationIds: [],
			promptInjectionRiskFlags: [],
		};
		expect(() => retrievedEvidenceSchema.parse(bad)).toThrow();
	});

	it("rejects an unknown trustTier value", () => {
		const bad = {
			url: "https://example.com",
			sourceType: "web",
			fetchedAt: "2026-06-29T00:00:00Z",
			contentHash: "abc",
			trustTier: "verified", // not in the enum
			extractionSpans: [],
			citationIds: [],
			promptInjectionRiskFlags: [],
		};
		expect(() => retrievedEvidenceSchema.parse(bad)).toThrow();
	});

	it("rejects an unknown sourceType value", () => {
		const bad = {
			url: "https://example.com",
			sourceType: "rss", // not in the enum
			fetchedAt: "2026-06-29T00:00:00Z",
			contentHash: "abc",
			trustTier: "untrusted",
			extractionSpans: [],
			citationIds: [],
			promptInjectionRiskFlags: [],
		};
		expect(() => retrievedEvidenceSchema.parse(bad)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// verifyCitations
// ---------------------------------------------------------------------------

describe("verifyCitations", () => {
	it("marks a claim as supported when all cited evidence ids exist and have spans", () => {
		const ev = makeEvidence({ citationIds: ["ev-1"], extractionSpans: [{ start: 0, end: 80 }] });
		const result = verifyCitations({
			claims: [{ id: "claim-A", citedEvidenceIds: ["ev-1"] }],
			evidence: [ev],
		});
		expect(result.supported).toEqual(["claim-A"]);
		expect(result.unsupported).toEqual([]);
	});

	it("marks a claim as unsupported when a cited evidence id is missing from evidence", () => {
		const ev = makeEvidence({ citationIds: ["ev-real"] });
		const result = verifyCitations({
			claims: [{ id: "claim-B", citedEvidenceIds: ["ev-real", "ev-missing"] }],
			evidence: [ev],
		});
		expect(result.supported).toEqual([]);
		expect(result.unsupported).toEqual(["claim-B"]);
	});

	it("marks a claim as unsupported when cited evidence has no extraction spans", () => {
		// Evidence was fetched but no content was extracted into the context window.
		const ev = makeEvidence({ citationIds: ["ev-empty"], extractionSpans: [] });
		const result = verifyCitations({
			claims: [{ id: "claim-C", citedEvidenceIds: ["ev-empty"] }],
			evidence: [ev],
		});
		expect(result.supported).toEqual([]);
		expect(result.unsupported).toEqual(["claim-C"]);
	});

	it("buckets multiple claims correctly across supported and unsupported", () => {
		const evGood = makeEvidence({
			citationIds: ["ev-good"],
			extractionSpans: [{ start: 0, end: 50 }],
		});
		const evNoSpan = makeEvidence({
			citationIds: ["ev-no-span"],
			extractionSpans: [],
		});
		const result = verifyCitations({
			claims: [
				{ id: "claim-ok", citedEvidenceIds: ["ev-good"] },
				{ id: "claim-no-span", citedEvidenceIds: ["ev-no-span"] },
				{ id: "claim-ghost", citedEvidenceIds: ["ev-does-not-exist"] },
			],
			evidence: [evGood, evNoSpan],
		});
		expect(result.supported).toEqual(["claim-ok"]);
		expect(result.unsupported).toEqual(["claim-no-span", "claim-ghost"]);
	});

	it("marks a claim with no cited evidence ids as unsupported (vacuous grounding is not grounding)", () => {
		const ev = makeEvidence({ citationIds: ["ev-1"] });
		const result = verifyCitations({
			claims: [{ id: "claim-nocite", citedEvidenceIds: [] }],
			evidence: [ev],
		});
		expect(result.supported).toEqual([]);
		expect(result.unsupported).toEqual(["claim-nocite"]);
	});
});

describe("extractionSpans schema tightening (int + sign)", () => {
	it("rejects negative or non-integer span offsets, accepts clean ones", async () => {
		const { retrievedEvidenceSchema } = await import("../../../src/core/retrieved-evidence");
		const base = {
			url: "https://example.com",
			sourceType: "web",
			fetchedAt: "2026-06-29T00:00:00Z",
			contentHash: "abc123",
			trustTier: "untrusted",
			citationIds: [],
			promptInjectionRiskFlags: [],
		};
		expect(retrievedEvidenceSchema.safeParse({ ...base, extractionSpans: [{ start: -1, end: 5 }] }).success).toBe(
			false,
		);
		expect(retrievedEvidenceSchema.safeParse({ ...base, extractionSpans: [{ start: 1.5, end: 5 }] }).success).toBe(
			false,
		);
		expect(retrievedEvidenceSchema.safeParse({ ...base, extractionSpans: [{ start: 0, end: 0 }] }).success).toBe(
			false,
		);
		expect(retrievedEvidenceSchema.safeParse({ ...base, extractionSpans: [{ start: 0, end: 5 }] }).success).toBe(
			true,
		);
	});
});
