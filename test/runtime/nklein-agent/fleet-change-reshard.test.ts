import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData, RuntimeFleetSizing } from "../../../src/core/api-contract";
import {
	advanceStableFleetObservation,
	applyFleetChangeReshardPlan,
	assertFleetReshardGraphAmendment,
	assertFleetReshardSubmissionSafe,
	fingerprintFleetRoutingCandidates,
	planFleetChangeReshard,
	snapshotFleetRoutingCandidates,
} from "../../../src/nklein-agent/decomposition/fleet-change-reshard";
import { applyNKleinPlanTaskGraphToBoard } from "../../../src/nklein-agent/decomposition/plan-task-board-apply";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../../../src/nklein-agent/nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../../../src/nklein-agent/nklein-task-router";

function candidate(modelId: string, capability: number, contextWindow = 64_000): NKleinTaskRoutingCandidate {
	const entry: NKleinModelRegistryEntry = {
		key: `lmstudio:${modelId}:http://localhost:1234/v1`,
		providerId: "lmstudio",
		modelId,
		endpoint: "http://localhost:1234/v1",
		contextWindow: { advertised: contextWindow, observed: null, userOverride: null, effective: contextWindow },
		speed: {
			samples: 0,
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
			samples: 0,
			staticPrior: capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: null,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
	return { entry, role: "worker" };
}

function emptyBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "ready", title: "Ready", cards: [] },
			{ id: "in_progress", title: "In progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
		streams: [],
	};
}

function card(id: string, planTaskId: string, sizing: RuntimeFleetSizing): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `Implement ${id}`,
		startInPlanMode: false,
		autoReviewEnabled: true,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		generatedFromPlan: {
			artifactKind: "decomposition",
			planSlug: "demo",
			planTaskId,
			sourceTaskId: "seed",
			fleetSizing: sizing,
		},
	};
}

function sizingFor(model: NKleinTaskRoutingCandidate, difficulty = 70): RuntimeFleetSizing {
	const candidates = snapshotFleetRoutingCandidates([model]);
	return {
		fingerprint: fingerprintFleetRoutingCandidates(candidates),
		candidates,
		taskDifficulty: difficulty,
		promptTokens: 1_000,
		fitBudgetTokens: 8_000,
		autoReshardOnFleetChange: true,
	};
}

function task(id: string, dependsOn: string[] = []): NKleinPlanTask {
	return {
		id,
		title: id,
		prompt: `Implement ${id}`,
		dependsOn,
		complexity: 30,
		suggestedRole: null,
		filesLikelyTouched: [`src/${id}.ts`],
		acceptanceCommand: "pnpm test",
		testFirst: false,
		acceptanceTestPrompt: null,
	};
}

describe("fleet-change re-shard planning", () => {
	it("requires two identical non-empty fleet observations", () => {
		const first = advanceStableFleetObservation(null, "a");
		expect(first.stable).toBe(false);
		expect(advanceStableFleetObservation(first.observation, "b").stable).toBe(false);
		expect(advanceStableFleetObservation(first.observation, "a").stable).toBe(true);
		expect(advanceStableFleetObservation(first.observation, "").observation).toBeNull();
	});

	it("rebinds a waiting card when another loaded model can clear it", () => {
		const board = emptyBoard();
		board.columns[0].cards.push(card("work", "work", sizingFor(candidate("old", 80), 55)));
		const replacement = candidate("replacement", 65);
		const plan = planFleetChangeReshard({ board, currentCandidates: [replacement], enabled: true });
		expect(plan.rebinds.map((entry) => entry.taskId)).toEqual(["work"]);
		expect(plan.strandedGroups).toEqual([]);
		const applied = applyFleetChangeReshardPlan({ board, plan, now: 10 });
		const rebound = applied.board.columns[0].cards[0];
		expect(rebound.nkleinSettings?.modelId).toBe("replacement");
		expect(rebound.generatedFromPlan?.fleetSizing?.fingerprint).toBe(plan.fingerprint);
	});

	it("blocks and scopes re-sharding to only un-clearable waiting cards", () => {
		const board = emptyBoard();
		board.columns[0].cards.push(card("stranded", "hard", sizingFor(candidate("old", 90))));
		board.columns[3].cards.push(card("running", "running", sizingFor(candidate("old", 90))));
		const plan = planFleetChangeReshard({
			board,
			currentCandidates: [candidate("tiny", 30)],
			activeTaskIds: new Set(["running"]),
			enabled: true,
		});
		expect(plan.strandedGroups[0]?.taskIds).toEqual(["stranded"]);
		const applied = applyFleetChangeReshardPlan({ board, plan, now: 20, createId: () => "unused" });
		expect(applied.blockedTaskIds).toEqual(["stranded"]);
		expect(applied.spawnedTaskIds).toHaveLength(1);
		expect(applied.board.columns[3].cards[0]?.blockedKind).toBeUndefined();
		const request = applied.board.columns[0].cards.find((entry) => entry.fleetReshardRequest)?.fleetReshardRequest;
		expect(request?.targetPlanTaskIds).toEqual(["hard"]);
	});

	it("honors the opt-out embedded in the plan receipt", () => {
		const board = emptyBoard();
		const sizing = sizingFor(candidate("old", 90));
		sizing.autoReshardOnFleetChange = false;
		board.columns[0].cards.push(card("work", "hard", sizing));
		const plan = planFleetChangeReshard({ board, currentCandidates: [candidate("tiny", 20)], enabled: true });
		expect(plan.rebinds).toEqual([]);
		expect(plan.strandedGroups).toEqual([]);
	});
});

describe("fleet re-shard amendment safety", () => {
	it("accepts only surgical replacements with both boundary directions rewired", () => {
		const graph = (tasks: NKleinPlanTask[]): NKleinPlanTaskGraph => ({
			schemaVersion: 1,
			slug: "demo",
			title: "Demo",
			tasks,
		});
		const current = graph([task("pre"), task("old", ["pre"]), task("dependent", ["old"])]);
		const valid = graph([
			task("pre"),
			task("leaf-a", ["pre"]),
			task("leaf-b", ["leaf-a"]),
			task("dependent", ["leaf-b"]),
		]);
		expect(() => assertFleetReshardGraphAmendment(current, valid, ["old"])).not.toThrow();
		const churned = graph(
			valid.tasks.map((entry) => (entry.id === "dependent" ? { ...entry, prompt: "changed" } : entry)),
		);
		expect(() => assertFleetReshardGraphAmendment(current, churned, ["old"])).toThrow(/changed unaffected/);
		const disconnected = graph(
			valid.tasks.map((entry) => (entry.id === "dependent" ? { ...entry, dependsOn: [] } : entry)),
		);
		expect(() => assertFleetReshardGraphAmendment(current, disconnected, ["old"])).toThrow(/reconnect dependent/);
	});

	it("rejects a different slug, an unexpanded target, and a target that started", () => {
		const board = emptyBoard();
		const target = card("old", "old", sizingFor(candidate("old-model", 80)));
		board.columns[0].cards.push(target);
		board.columns[1].cards.push({
			...target,
			id: "request",
			generatedFromPlan: undefined,
			fleetReshardRequest: {
				planSlug: "demo",
				targetPlanTaskIds: ["old"],
				fromFleetFingerprints: ["old"],
				toFleetFingerprint: "new",
				requestedAt: 2,
			},
		});
		const graph = (slug: string, tasks: NKleinPlanTask[]): NKleinPlanTaskGraph => ({
			schemaVersion: 1,
			slug,
			title: "Demo",
			tasks,
		});
		expect(() => assertFleetReshardSubmissionSafe(board, "request", graph("other", [task("new")]))).toThrow(
			/existing plan/,
		);
		expect(() => assertFleetReshardSubmissionSafe(board, "request", graph("demo", [task("old")]))).toThrow(
			/did not replace/,
		);
		board.columns[3].cards.push(board.columns[0].cards.pop() as RuntimeBoardCard);
		expect(() => assertFleetReshardSubmissionSafe(board, "request", graph("demo", [task("new")]))).toThrow(
			/no longer a waiting card/,
		);
	});

	it("replaces only requested plan nodes and rewires their dependents", () => {
		const board = emptyBoard();
		const receipt = sizingFor(candidate("old-model", 80));
		board.columns[0].cards.push(card("demo-old", "old", receipt));
		board.columns[0].cards.push(card("demo-dependent", "dependent", receipt));
		board.columns[1].cards.push({
			...card("request", "request", receipt),
			generatedFromPlan: undefined,
			startInPlanMode: true,
			fleetReshardRequest: {
				planSlug: "demo",
				targetPlanTaskIds: ["old"],
				fromFleetFingerprints: [receipt.fingerprint],
				toFleetFingerprint: "tiny",
				requestedAt: 2,
			},
		});
		board.dependencies.push({ id: "old-edge", fromTaskId: "demo-dependent", toTaskId: "demo-old", createdAt: 1 });
		const result = applyNKleinPlanTaskGraphToBoard({
			board,
			taskGraph: {
				schemaVersion: 1,
				slug: "demo",
				title: "Demo",
				tasks: [task("leaf-a"), task("leaf-b", ["leaf-a"]), task("dependent", ["leaf-b"])],
			},
			baseRef: "main",
			randomUuid: () => "uuid",
			sourceTaskId: "request",
			now: 30,
		});
		expect(result.board.columns.find((column) => column.id === "trash")?.cards.map((entry) => entry.id)).toContain(
			"demo-old",
		);
		expect(
			result.board.columns.flatMap((column) => column.cards).some((entry) => entry.id === "demo-dependent"),
		).toBe(true);
		expect(result.board.dependencies).toContainEqual(
			expect.objectContaining({ fromTaskId: "demo-dependent", toTaskId: "demo-leaf-b" }),
		);
		expect(result.board.dependencies.some((edge) => edge.toTaskId === "demo-old")).toBe(false);
	});
});
