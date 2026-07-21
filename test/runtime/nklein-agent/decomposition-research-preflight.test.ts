import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildResearchFreshnessEvent } from "../../../src/core/agent-attempt-ledger";
import {
	buildDecompositionResearchTopicKey,
	runDecompositionResearchPreflight,
} from "../../../src/core/decomposition-research-preflight";
import type { RetrievalLoopResult } from "../../../src/core/retrieval-loop-driver";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = new Date("2026-07-21T12:00:00.000Z");

interface FreshnessFixture {
	name: string;
	taskText: string;
	priorEvidenceAgeDays: number;
	priorCitation: string;
	refreshedCitation: string;
	expectedSearch: boolean;
	expectedVerdict: "current" | "recent" | "possibly_stale" | "stale" | "unknown";
}

async function fixtures(): Promise<FreshnessFixture[]> {
	const path = new URL("../../../packages/llm-simulator/fixtures/decomposition-freshness.json", import.meta.url);
	return JSON.parse(await readFile(path, "utf8")) as FreshnessFixture[];
}

function priorEvent(fixture: FreshnessFixture): AgentLedgerEvent {
	const evidenceAt = NOW.getTime() - fixture.priorEvidenceAgeDays * DAY;
	return buildResearchFreshnessEvent({
		workflowId: "prior",
		taskId: "prior",
		workspacePathHash: "workspace",
		topicKey: buildDecompositionResearchTopicKey(fixture.taskText),
		query: fixture.taskText,
		action: "retrieve_online",
		verdict: "current",
		reason: "fixture seed",
		knowledgeAtBefore: null,
		evidenceAt,
		searchAttempted: true,
		searchSucceeded: true,
		citations: [fixture.priorCitation],
		recordedAt: evidenceAt,
	});
}

function researchResult(citation: string): RetrievalLoopResult {
	return {
		queryPlan: {
			primaryQuery: "current API",
			alternateQueries: [],
			freshnessNeed: "fresh",
		},
		actions: ["formulate_query", "search", "fetch", "synthesize", "stop_sufficient"],
		evidence: [{ id: "current-doc", url: citation, text: "Current authoritative API documentation." }],
		sufficiency: { sufficient: true, reasons: ["fixture"], unmetSubQuestions: [] },
		answer: null,
		stoppedBecause: "sufficient",
		iterations: 1,
	};
}

describe("decomposition research preflight — F4.4 simulator fixtures", () => {
	it("searches stale knowledge, skips fresh knowledge, and cites both decisions", async () => {
		for (const fixture of await fixtures()) {
			const appended: AgentLedgerEvent[] = [];
			let researchCalls = 0;
			const result = await runDecompositionResearchPreflight(
				{
					taskId: `fixture-${fixture.name}`,
					workspacePathHash: "workspace",
					taskText: fixture.taskText,
					egressAvailable: true,
				},
				{
					now: () => NOW,
					readLedger: async () => [priorEvent(fixture)],
					appendLedger: async (event) => {
						appended.push(event);
					},
					runResearch: async () => {
						researchCalls++;
						return researchResult(fixture.refreshedCitation);
					},
				},
			);

			expect(result.searchAttempted, fixture.name).toBe(fixture.expectedSearch);
			expect(researchCalls, fixture.name).toBe(fixture.expectedSearch ? 1 : 0);
			expect(result.verdict, fixture.name).toBe(fixture.expectedVerdict);
			const expectedCitation = fixture.expectedSearch ? fixture.refreshedCitation : fixture.priorCitation;
			expect(result.citations, fixture.name).toContain(expectedCitation);
			expect(result.promptBlock, fixture.name).toContain(expectedCitation);
			expect(result.promptBlock, fixture.name).toContain(fixture.expectedSearch ? "SEARCHED" : "SKIPPED");
			const decision = appended.at(-1);
			expect(decision?.kind, fixture.name).toBe("research_freshness");
			if (decision?.kind === "research_freshness") {
				expect(decision.citations, fixture.name).toContain(expectedCitation);
				expect(decision.searchAttempted, fixture.name).toBe(fixture.expectedSearch);
			}
			// A skip is a decision event only; it must not masquerade as a retrieval call in the ledger.
			expect(appended.filter((event) => event.kind === "retrieval").length, fixture.name).toBe(
				fixture.expectedSearch ? 1 : 0,
			);
		}
	});

	it("does not mark a failed or empty refresh fresh", async () => {
		const taskText = "Decompose support for the latest release of Qwen.";
		const result = await runDecompositionResearchPreflight(
			{ taskId: "empty", workspacePathHash: "workspace", taskText, egressAvailable: true },
			{
				now: () => NOW,
				readLedger: async () => [],
				appendLedger: async () => {},
				runResearch: async () => ({ ...researchResult("unused"), evidence: [] }),
			},
		);
		expect(result.searchAttempted).toBe(true);
		expect(result.searchSucceeded).toBe(false);
		expect(result.evidenceAt).toBeNull();
		expect(result.promptBlock).toContain("no usable cited evidence");
	});

	it("admits only normalized HTTP(S) citations into the trusted system-prompt block", async () => {
		const taskText = "Decompose support for the latest release of Qwen.";
		const result = await runDecompositionResearchPreflight(
			{ taskId: "taint", workspacePathHash: "workspace", taskText, egressAvailable: true },
			{
				now: () => NOW,
				readLedger: async () => [],
				appendLedger: async () => {},
				runResearch: async () => ({
					...researchResult("https://docs.example.test/current"),
					evidence: [
						{ id: "bad", url: "javascript:ignore_previous_instructions()", text: "bad" },
						{ id: "good", url: "https://docs.example.test/current", text: "good" },
					],
				}),
			},
		);
		expect(result.citations).toEqual(["https://docs.example.test/current"]);
		expect(result.promptBlock).not.toContain("javascript:");
	});
});
