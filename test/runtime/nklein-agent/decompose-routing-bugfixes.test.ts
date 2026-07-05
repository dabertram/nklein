import { describe, expect, it } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { applyNKleinPlanTaskGraphToBoard } from "../../../src/nklein-agent/decomposition/plan-task-board-apply";
import {
	previewNKleinPlanTaskGraphWithFallback,
	selectTaskRoutingCandidate,
} from "../../../src/nklein-agent/decomposition/plan-task-routing";
import {
	normalizeTaskAcceptanceCommand,
	validateNKleinPlanTaskGraph,
} from "../../../src/nklein-agent/decomposition/plan-task-validation";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../../../src/nklein-agent/nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../../../src/nklein-agent/nklein-task-router";
import { routeNKleinTask } from "../../../src/nklein-agent/nklein-task-router";

// Regression tests for the 6 bugs the decompose/routing bug-hunt confirmed (2026-07-05).

function task(partial: Partial<NKleinPlanTask> & Pick<NKleinPlanTask, "id" | "title">): NKleinPlanTask {
	return {
		prompt: partial.prompt ?? partial.title,
		dependsOn: partial.dependsOn ?? [],
		complexity: partial.complexity ?? 40,
		suggestedRole: partial.suggestedRole ?? null,
		filesLikelyTouched: partial.filesLikelyTouched ?? [],
		acceptanceCommand: partial.acceptanceCommand ?? "npm test",
		testFirst: partial.testFirst ?? false,
		acceptanceTestPrompt: partial.acceptanceTestPrompt ?? null,
		knowledgeDebt: partial.knowledgeDebt ?? null,
		...partial,
	};
}

function graph(tasks: NKleinPlanTask[]): NKleinPlanTaskGraph {
	return { schemaVersion: 1, slug: "demo", title: "Demo", tasks };
}

function entry(key: string, capability: number, contextWindow = 128_000): NKleinModelRegistryEntry {
	const [providerId = "provider", modelId = key, endpoint = "default"] = key.split(":");
	return {
		key,
		providerId,
		modelId,
		endpoint,
		contextWindow: { advertised: contextWindow, observed: null, userOverride: null, effective: contextWindow },
		speed: {
			samples: 1,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: null,
			decodeTokensPerSecondEwma: null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 1,
			staticPrior: capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: endpoint,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

const candidate = (key: string, capability: number, role: string | null = "worker"): NKleinTaskRoutingCandidate => ({
	entry: entry(key, capability),
	role,
});

describe("bug #2 — defaultAcceptanceCommand is FILL-ONLY (decided 2026-07-05, David)", () => {
	it("keeps the task's own acceptanceCommand when a non-null default is supplied", () => {
		const normalized = normalizeTaskAcceptanceCommand(
			task({ id: "t", title: "T", acceptanceCommand: "pnpm test:unit -- graph" }),
			"pnpm test",
		);
		expect(normalized.acceptanceCommand).toBe("pnpm test:unit -- graph");
	});

	it("fills from the default only when the task omits (empty/whitespace) its own", () => {
		const filled = normalizeTaskAcceptanceCommand(
			task({ id: "t", title: "T", acceptanceCommand: "   " }),
			"pnpm test",
		);
		expect(filled.acceptanceCommand).toBe("pnpm test");
	});

	it("is null when neither the task nor the default supplies one", () => {
		const none = normalizeTaskAcceptanceCommand(task({ id: "t", title: "T", acceptanceCommand: "" }), null);
		expect(none.acceptanceCommand).toBeNull();
	});
});

describe("bug #4 — a padded task id is trimmed to match its (trimmed) dependency references", () => {
	it("trims the id in normalizeTaskAcceptanceCommand", () => {
		expect(normalizeTaskAcceptanceCommand(task({ id: " build ", title: "Build" }), null).id).toBe("build");
	});

	it("no longer bogus-rejects a legit edge to a padded id as 'unknown task'", () => {
		const g = graph([
			task({ id: " build ", title: "Build" }),
			task({ id: "test", title: "Test", dependsOn: [" build "] }),
		]);
		expect(() => validateNKleinPlanTaskGraph({ taskGraph: g })).not.toThrow();
		const result = validateNKleinPlanTaskGraph({ taskGraph: g });
		expect(result.taskGraph.tasks.map((t) => t.id)).toEqual(["build", "test"]);
		expect(result.dependencyCount).toBe(1);
	});
});

describe("bug #1/#6 — preview degrades to deferred selection when a card is infeasible for every candidate", () => {
	const hardCard = graph([task({ id: "hard", title: "Very hard", complexity: 70 })]);

	it("selectTaskRoutingCandidate throws the feasibility guard for an all-infeasible candidate set (the precondition)", () => {
		// A local model too weak (capability 30) for a complexity-70 card ⇒ routeNKleinTask returns decompose ⇒ throw.
		expect(() =>
			selectTaskRoutingCandidate(hardCard.tasks[0], "prompt", [candidate("ollama:weak:default", 30)]),
		).toThrow(/feasibility guard/);
	});

	it("previewNKleinPlanTaskGraphWithFallback does NOT throw — it previews as 'model selected at start'", () => {
		const preview = previewNKleinPlanTaskGraphWithFallback({
			taskGraph: hardCard,
			routingCandidates: [candidate("ollama:weak:default", 30)],
		});
		expect(preview.taskCount).toBe(1);
		expect(preview.tasks[0].modelLabel).toBe("model selected at start");
	});

	it("still labels the concrete model when a candidate IS feasible", () => {
		const preview = previewNKleinPlanTaskGraphWithFallback({
			taskGraph: graph([task({ id: "easy", title: "Easy", complexity: 40 })]),
			routingCandidates: [candidate("ollama:capable:default", 80)],
		});
		expect(preview.tasks[0].modelLabel).toBe("ollama/capable");
	});
});

describe("bug #3 — an empty task graph must not silently complete (discard) the source planning card", () => {
	const board = (): RuntimeBoardData =>
		({
			columns: [
				{ id: "planning", cards: [{ id: "src-1", title: "Plan it" }] },
				{ id: "completed", cards: [] },
			],
		}) as unknown as RuntimeBoardData;

	const columnOf = (b: RuntimeBoardData, cardId: string): string | undefined =>
		b.columns.find((column) => column.cards.some((card) => card.id === cardId))?.id;

	it("leaves the source card in place (does not move it to completed) when the graph produced no cards", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: board(),
			taskGraph: graph([]),
			baseRef: "main",
			randomUuid: () => "uuid",
			sourceTaskId: "src-1",
			now: 1,
		});
		expect(result.createdTasks).toHaveLength(0);
		expect(columnOf(result.board, "src-1")).toBe("planning");
	});
	// The normal path (a NON-empty decomposition completes the source card) is covered end-to-end by the full-board
	// applies in nklein-decomposition-tool.test.ts; the guard only ADDS `producedCards &&`, a no-op when cards exist.
});

describe("bug #5 — the router picks deterministically among equal candidates lacking cost/speed (no NaN comparator)", () => {
	// All four are equally capable + feasible, none has a costRank or predicted wall-time, so the cost/wall-time steps
	// both hit the Infinity sentinel; the fixed comparator falls through to the deterministic localeCompare(key) tiebreak.
	const keys = ["ollama:delta:default", "ollama:alpha:default", "ollama:charlie:default", "ollama:bravo:default"];
	const pick = (order: string[]) =>
		routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			candidates: order.map((k) => candidate(k, 60)),
		});

	const pickedKey = (order: string[]): string => {
		const decision = pick(order);
		if (decision.type !== "assign") {
			throw new Error(`expected an assign decision, got ${decision.type}`);
		}
		return decision.modelKey;
	};

	it("returns the same model regardless of candidate insertion order", () => {
		const a = pickedKey(keys);
		const b = pickedKey([...keys].reverse());
		const c = pickedKey([
			"ollama:charlie:default",
			"ollama:delta:default",
			"ollama:alpha:default",
			"ollama:bravo:default",
		]);
		expect(a).toBe("ollama:alpha:default"); // the localeCompare-min key wins deterministically
		expect(b).toBe(a);
		expect(c).toBe(a);
	});
});
