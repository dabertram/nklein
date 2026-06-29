import { describe, expect, it } from "vitest";
import { buildRetrievalQueryPlan } from "../../../src/core/retrieval-query-plan";

describe("buildRetrievalQueryPlan", () => {
	it("primaryQuery trims and collapses internal whitespace", () => {
		const plan = buildRetrievalQueryPlan({ task: "  find  the  best  approach  " });
		expect(plan.primaryQuery).toBe("find the best approach");
	});

	it("builds one alternate query per debt item as 'debtItem task'", () => {
		const plan = buildRetrievalQueryPlan({
			task: "deploy service",
			knowledgeDebt: ["docker networking", "TLS setup"],
		});
		expect(plan.alternateQueries).toEqual(["docker networking deploy service", "TLS setup deploy service"]);
	});

	it("caps alternateQueries at 5 even when more debt items are provided", () => {
		const plan = buildRetrievalQueryPlan({
			task: "optimise pipeline",
			knowledgeDebt: ["A", "B", "C", "D", "E", "F", "G"],
		});
		expect(plan.alternateQueries).toHaveLength(5);
	});

	it("dedupes alternate queries that would produce the same string", () => {
		const plan = buildRetrievalQueryPlan({
			task: "task",
			knowledgeDebt: ["debt item", "debt item", "unique item"],
		});
		expect(plan.alternateQueries).toEqual(["debt item task", "unique item task"]);
	});

	it("excludes any alternate that equals the primaryQuery", () => {
		// debt item + task collapses to same string as primaryQuery when debt item is empty-ish after collapse
		const plan = buildRetrievalQueryPlan({
			task: "find memory leak",
			knowledgeDebt: ["", "  ", "heap profiling"],
		});
		// empty / whitespace-only debt items produce "find memory leak" which equals primaryQuery → excluded
		expect(plan.alternateQueries).toEqual(["heap profiling find memory leak"]);
	});

	it("freshnessNeed is 'fresh' when freshnessSensitive flag is set", () => {
		const plan = buildRetrievalQueryPlan({ task: "stable unrelated task", freshnessSensitive: true });
		expect(plan.freshnessNeed).toBe("fresh");
	});

	it("freshnessNeed is 'fresh' when task contains a recency cue (case-insensitive)", () => {
		expect(buildRetrievalQueryPlan({ task: "get the latest docs" }).freshnessNeed).toBe("fresh");
		expect(buildRetrievalQueryPlan({ task: "what is the CURRENT price?" }).freshnessNeed).toBe("fresh");
		expect(buildRetrievalQueryPlan({ task: "show today changes" }).freshnessNeed).toBe("fresh");
		expect(buildRetrievalQueryPlan({ task: "read the changelog" }).freshnessNeed).toBe("fresh");
		expect(buildRetrievalQueryPlan({ task: "find 2026 release notes" }).freshnessNeed).toBe("fresh");
	});

	it("freshnessNeed defaults to 'any' when no flag and no recency cue", () => {
		const plan = buildRetrievalQueryPlan({ task: "explain binary search", knowledgeDebt: ["complexity"] });
		expect(plan.freshnessNeed).toBe("any");
	});
});
