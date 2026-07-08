import { describe, expect, it } from "vitest";
import {
	type AgentLedgerEvent,
	agentLedgerEventSchema,
	buildRetrievalEvent,
	buildSchedulerEvent,
} from "../../../src/core/agent-attempt-ledger";
import { summarizeRetrievalUsefulness } from "../../../src/core/retrieval-ledger-projection";

const base = { workflowId: "wf", taskId: "t", workspacePathHash: "ws" };

describe("retrieval ledger event", () => {
	it("builds a schema-valid retrieval event with clamped counts + deduped citations", () => {
		const event = buildRetrievalEvent({
			...base,
			query: "how to cap a score",
			hitsConsidered: 5,
			distractorsPruned: 99, // clamped to hitsConsidered
			citations: [" a ", "a", "", "b"], // trimmed + deduped + empties dropped
			signal: "helped",
		});
		expect(() => agentLedgerEventSchema.parse(event)).not.toThrow();
		expect(event.kind).toBe("retrieval");
		expect(event.distractorsPruned).toBe(5);
		expect(event.citations).toEqual(["a", "b"]);
	});

	it("defaults counts to 0 and signal to unknown", () => {
		const event = buildRetrievalEvent({ ...base, query: "q" });
		expect(event).toMatchObject({
			hitsConsidered: 0,
			distractorsPruned: 0,
			citations: [],
			signal: "unknown",
			attemptId: null,
		});
	});
});

describe("summarizeRetrievalUsefulness", () => {
	function retrieval(
		signal: "helped" | "hurt" | "neutral" | "unknown",
		hits: number,
		pruned: number,
		citations: string[],
	) {
		return buildRetrievalEvent({
			...base,
			query: "q",
			hitsConsidered: hits,
			distractorsPruned: pruned,
			citations,
			signal,
		});
	}

	it("is total over a retrieval-free ledger", () => {
		const events: AgentLedgerEvent[] = [buildSchedulerEvent({ ...base, event: "queued" })];
		expect(summarizeRetrievalUsefulness(events)).toEqual({
			total: 0,
			helped: 0,
			hurt: 0,
			neutral: 0,
			unknown: 0,
			helpfulRate: 0,
			meanDistractorPruneRatio: null,
			totalCitations: 0,
			distinctCitedSources: 0,
		});
	});

	it("counts signals, computes helpfulRate over VERDICTS (unknown excluded), and dedupes sources", () => {
		const events = [
			retrieval("helped", 10, 6, ["src-a", "src-b"]),
			retrieval("helped", 4, 1, ["src-a"]), // src-a repeats across turns → one distinct source
			retrieval("hurt", 8, 2, ["src-c"]),
			retrieval("unknown", 0, 0, []), // excluded from helpfulRate + prune ratio
		];
		const s = summarizeRetrievalUsefulness(events);
		expect(s.total).toBe(4);
		expect(s).toMatchObject({ helped: 2, hurt: 1, neutral: 0, unknown: 1 });
		expect(s.helpfulRate).toBeCloseTo(2 / 3, 5); // 2 helped of 3 verdicts
		// prune ratios: 0.6, 0.25, 0.25 (the unknown had hits=0 → excluded) → mean ~0.3667
		expect(s.meanDistractorPruneRatio).toBeCloseTo((0.6 + 0.25 + 0.25) / 3, 5);
		expect(s.totalCitations).toBe(4); // 2 + 1 + 1 + 0
		expect(s.distinctCitedSources).toBe(3); // src-a, src-b, src-c
	});
});
