import { describe, expect, it } from "vitest";
import { decideResearchFreshnessGate } from "../../../src/core/research-freshness-gate";

const NOW = new Date("2026-07-08T00:00:00Z");

describe("decideResearchFreshnessGate (§5.AC stale-knowledge → online-retrieval routing)", () => {
	it("stale knowledge on a fast-moving topic triggers online retrieval with a surfaced reason", () => {
		const decision = decideResearchFreshnessGate({
			taskText: "compare the latest LLM model releases this month",
			knowledgeAt: "2025-01-01",
			now: NOW,
			egressAvailable: true,
		});
		expect(decision.action).toBe("retrieve_online");
		expect(decision.verdict).toBe("stale");
		expect(decision.reason).toContain("refreshing online");
	});

	it("fresh knowledge skips the online refresh; an evergreen topic tolerates old dated knowledge", () => {
		const fresh = decideResearchFreshnessGate({
			taskText: "compare the latest LLM model releases",
			knowledgeAt: "2026-07-05",
			now: NOW,
			egressAvailable: true,
		});
		expect(fresh.action).toBe("use_local");
		const evergreen = decideResearchFreshnessGate({
			taskText: "explain the quicksort algorithm partition step",
			knowledgeAt: "2023-01-01",
			now: NOW,
			egressAvailable: true,
		});
		expect(evergreen.action).toBe("use_local");
	});

	it("UNDATED knowledge retrieves online only on realtime/fast topics", () => {
		const volatile_ = decideResearchFreshnessGate({
			taskText: "what are the newest model releases today",
			knowledgeAt: null,
			now: NOW,
			egressAvailable: true,
		});
		expect(volatile_.action).toBe("retrieve_online");
		const stable = decideResearchFreshnessGate({
			taskText: "explain the quicksort algorithm",
			knowledgeAt: null,
			now: NOW,
			egressAvailable: true,
		});
		expect(stable.action).toBe("use_local");
	});

	it("no egress ⇒ always use_local (never demands the network), verdict still surfaced", () => {
		const decision = decideResearchFreshnessGate({
			taskText: "compare the latest LLM model releases this month",
			knowledgeAt: "2025-01-01",
			now: NOW,
			egressAvailable: false,
		});
		expect(decision.action).toBe("use_local");
		expect(decision.verdict).toBe("stale");
		expect(decision.reason).toContain("unavailable");
	});
});
