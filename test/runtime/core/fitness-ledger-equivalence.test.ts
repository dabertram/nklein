import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import { buildFitnessTableFromLedger } from "../../../src/core/agent-ledger-projections";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	emptyFitnessRow,
	type FitnessRow,
	fitnessCellKey,
	recordFitnessOutcome,
} from "../../../src/core/fitness-table-schema";
import { buildTerminalAttemptEvent } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { deriveTaskDifficultyTier, deriveTaskFitnessRecord } from "../../../src/nklein-agent/task-fitness-recording";

/**
 * F1.15b — the fixture LOCK: the ledger projection (`buildFitnessTableFromLedger`, folding attempt events through
 * `recordFitnessOutcome`) reproduces the parallel store path (`deriveTaskFitnessRecord` → the same fold) EXACTLY on
 * the shared classifiable domain — same terminal runs in, identical FitnessRow cells out. This is the equivalence
 * the F1.15c read-side flip depends on. The documented divergences stay OUTSIDE the shared domain and are asserted
 * as such (synthetic sessions, interrupts, chat-flow attempts, and the projection's richer tokensPerSec).
 */

interface Run {
	taskId: string;
	title: string;
	state: "awaiting_review" | "failed" | "interrupted";
	providerId: string;
	modelId: string;
	endpoint: string;
	startedAt: number;
	endedAt: number;
	usedKnowledgeTools: boolean | null;
}

function card(run: Run): RuntimeBoardCard {
	return {
		id: run.taskId,
		title: run.title,
		prompt: run.title,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function summary(run: Run): RuntimeTaskSessionSummary {
	return {
		taskId: run.taskId,
		state: run.state === "awaiting_review" ? "awaiting_review" : run.state,
		agentId: "nklein",
		workspacePath: "/repo",
		pid: 1,
		startedAt: run.startedAt,
		updatedAt: run.endedAt,
		lastOutputAt: run.endedAt,
		reviewReason: null,
		exitCode: null,
		lastHookAt: run.endedAt,
		latestHookActivity: null,
		providerId: run.providerId,
		modelId: run.modelId,
		endpoint: run.endpoint,
	};
}

/** Path A — the live store path: deriveTaskFitnessRecord + the store's fold (recordFitnessOutcome). */
function foldViaStorePath(runs: Run[]): Record<string, FitnessRow> {
	const rows: Record<string, FitnessRow> = {};
	for (const run of runs) {
		const record = deriveTaskFitnessRecord({ summary: summary(run), card: card(run) });
		if (!record) {
			continue;
		}
		const cell = fitnessCellKey(record.key);
		rows[cell] = recordFitnessOutcome(
			rows[cell] ?? emptyFitnessRow(record.key),
			{ ...record.outcome, usedKnowledgeTools: run.usedKnowledgeTools },
			run.endedAt,
		);
	}
	return rows;
}

/** Path B — the ledger path: the F1.14 terminal attempt write, projected by buildFitnessTableFromLedger. */
function attemptEventFor(run: Run): AgentLedgerEvent {
	return buildTerminalAttemptEvent({
		taskId: run.taskId,
		workspacePath: "/repo",
		state: run.state,
		role: "worker",
		providerId: run.providerId,
		modelId: run.modelId,
		endpoint: run.endpoint,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
		promptTokens: null,
		completionTokens: null, // tokensPerSec is the projection's ENRICHMENT; null here for the strict lock
		timeoutReason: null,
		difficulty: deriveTaskDifficultyTier(run.taskId, card(run)),
		knowledge:
			run.usedKnowledgeTools === null
				? null
				: {
						retrievalCallCount: run.usedKnowledgeTools ? 2 : 0,
						localizationCallCount: 1,
						knowledgeErrorCount: 0,
						categoriesUsed: run.usedKnowledgeTools ? ["code_search"] : [],
						knowledgeDebtPresent: null,
					},
	});
}

const RUNS: Run[] = [
	{
		taskId: "t-a1",
		title: "Fix the login form validation message",
		state: "awaiting_review",
		providerId: "lmstudio",
		modelId: "qwen/qwen3-8b",
		endpoint: "http://127.0.0.1:1234/v1",
		startedAt: 1_000,
		endedAt: 61_000,
		usedKnowledgeTools: true,
	},
	{
		taskId: "t-a2",
		title: "Fix the login form validation message again",
		state: "failed",
		providerId: "lmstudio",
		modelId: "qwen/qwen3-8b",
		endpoint: "http://127.0.0.1:1234/v1",
		startedAt: 2_000,
		endedAt: 92_000,
		usedKnowledgeTools: false,
	},
	{
		taskId: "t-b1",
		title: "Implement the entire distributed realtime sync engine with conflict resolution and migration tooling",
		state: "awaiting_review",
		providerId: "lmstudio",
		modelId: "qwen/qwen3.6-35b",
		endpoint: "http://127.0.0.1:1234/v1",
		startedAt: 5_000,
		endedAt: 905_000,
		usedKnowledgeTools: null,
	},
];

describe("F1.15b fitness projection equivalence (fixture lock)", () => {
	it("the ledger projection reproduces the store fold EXACTLY on the shared classifiable domain", () => {
		const storeRows = foldViaStorePath(RUNS);
		const ledgerRows = buildFitnessTableFromLedger(RUNS.map(attemptEventFor));
		expect(Object.keys(storeRows).length).toBeGreaterThanOrEqual(2); // the fixture exercises multiple cells
		expect(ledgerRows).toEqual(storeRows);
	});

	it("both paths skip the non-classifiable edges the same way (synthetic, interrupted)", () => {
		const edges: Run[] = [
			{ ...RUNS[0]!, taskId: "t-a1::review", title: "Synthetic review" },
			{ ...RUNS[0]!, taskId: "t-int", state: "interrupted" },
		];
		expect(foldViaStorePath(edges)).toEqual({});
		expect(buildFitnessTableFromLedger(edges.map(attemptEventFor))).toEqual({});
	});

	it("documented projection-only behaviors: chat-flow attempts are excluded; tokensPerSec is an enrichment", () => {
		const boardEvent = attemptEventFor(RUNS[0]!);
		const chatEvent = { ...boardEvent, flow: "chat" };
		expect(buildFitnessTableFromLedger([chatEvent])).toEqual({});

		// With completion tokens the projection also folds throughput — richer than the store path, never less.
		const withTokens = buildTerminalAttemptEvent({
			taskId: RUNS[0]!.taskId,
			workspacePath: "/repo",
			state: "awaiting_review",
			role: "worker",
			providerId: RUNS[0]!.providerId,
			modelId: RUNS[0]!.modelId,
			endpoint: RUNS[0]!.endpoint,
			startedAt: 0,
			endedAt: 10_000,
			promptTokens: 100,
			completionTokens: 500, // 50 tok/s
			timeoutReason: null,
			difficulty: "easy",
		});
		const rows = buildFitnessTableFromLedger([withTokens]);
		const row = Object.values(rows)[0];
		expect(row?.tokensPerSec).toBe(50);
		expect(row?.tokensPerSecSamples).toBe(1);
	});
});
