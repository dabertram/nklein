import { describe, expect, it } from "vitest";
import {
	ageDecay,
	deweightRecall,
	type NoteProvenance,
	type RecallCandidate,
	renderProvenanceFrontmatter,
	UNAUDITED_RECALL_WEIGHT,
	verdictRecallWeight,
} from "../../../src/core/basic-memory-provenance";

const prov: NoteProvenance = {
	authoredBy: "qwen/qwen3-8b",
	taskId: "card-42",
	createdAtIso: "2026-07-05T00:00:00Z",
	commitSha: "abc123",
	auditVerdict: "confirmed",
};

describe("renderProvenanceFrontmatter", () => {
	it("renders a well-formed YAML frontmatter block with all provenance fields", () => {
		const fm = renderProvenanceFrontmatter(prov);
		expect(fm.startsWith("---\n")).toBe(true);
		expect(fm.endsWith("\n---")).toBe(true);
		expect(fm).toContain('authored_by: "qwen/qwen3-8b"');
		expect(fm).toContain('task_id: "card-42"');
		expect(fm).toContain('commit: "abc123"');
		expect(fm).toContain('audit_verdict: "confirmed"');
	});

	it("emits null (unquoted) for a missing commit / unaudited note", () => {
		const fm = renderProvenanceFrontmatter({ ...prov, commitSha: null, auditVerdict: null });
		expect(fm).toContain("commit: null");
		expect(fm).toContain("audit_verdict: null");
	});

	it("escapes quotes/backslashes so a value can't break the block", () => {
		const fm = renderProvenanceFrontmatter({ ...prov, authoredBy: 'weird"\\model' });
		expect(fm).toContain('authored_by: "weird\\"\\\\model"');
	});
});

describe("verdictRecallWeight", () => {
	it("confirmed=1, unverifiable=0.3, contradicted=0, unaudited=UNAUDITED_RECALL_WEIGHT", () => {
		expect(verdictRecallWeight("confirmed")).toBe(1);
		expect(verdictRecallWeight("unverifiable")).toBe(0.3);
		expect(verdictRecallWeight("contradicted")).toBe(0);
		expect(verdictRecallWeight(null)).toBe(UNAUDITED_RECALL_WEIGHT);
		expect(verdictRecallWeight(undefined)).toBe(UNAUDITED_RECALL_WEIGHT);
	});
});

describe("ageDecay", () => {
	it("is 1 fresh, 0.5 at one half-life, and monotonically decreasing", () => {
		expect(ageDecay(0)).toBe(1);
		expect(ageDecay(90, 90)).toBeCloseTo(0.5, 10);
		expect(ageDecay(180, 90)).toBeCloseTo(0.25, 10);
		expect(ageDecay(400)).toBeLessThan(ageDecay(100));
	});

	it("clamps negative age to fresh", () => {
		expect(ageDecay(-5)).toBe(1);
	});
});

describe("deweightRecall", () => {
	const c = (ref: string, over: Partial<RecallCandidate>): RecallCandidate => ({
		ref,
		baseRelevance: 1,
		auditVerdict: null,
		ageDays: 0,
		...over,
	});

	it("a confirmed fresh note outranks an equally-relevant unaudited one", () => {
		const ranked = deweightRecall([
			c("unaudited", { auditVerdict: null }),
			c("confirmed", { auditVerdict: "confirmed" }),
		]);
		expect(ranked[0]?.ref).toBe("confirmed");
	});

	it("drops contradicted notes entirely by default", () => {
		const ranked = deweightRecall([
			c("bad", { auditVerdict: "contradicted", baseRelevance: 99 }),
			c("ok", { auditVerdict: "confirmed", baseRelevance: 1 }),
		]);
		expect(ranked.map((r) => r.ref)).toEqual(["ok"]);
	});

	it("can keep contradicted notes (scored 0) when dropContradicted is false", () => {
		const ranked = deweightRecall([c("bad", { auditVerdict: "contradicted" })], { dropContradicted: false });
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.effectiveScore).toBe(0);
	});

	it("age decays a stale confirmed note below a fresh confirmed one of equal base relevance", () => {
		const ranked = deweightRecall([
			c("stale", { auditVerdict: "confirmed", ageDays: 365 }),
			c("fresh", { auditVerdict: "confirmed", ageDays: 0 }),
		]);
		expect(ranked[0]?.ref).toBe("fresh");
	});

	it("effectiveScore = base × verdictWeight × ageDecay", () => {
		const [only] = deweightRecall([c("n", { auditVerdict: "unverifiable", baseRelevance: 2, ageDays: 90 })]);
		expect(only?.effectiveScore).toBeCloseTo(2 * 0.3 * 0.5, 10);
	});
});
