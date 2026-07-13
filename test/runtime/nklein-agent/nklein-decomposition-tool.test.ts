import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS } from "../../../src/core/autonomous-timeout-defaults";
import { createGitProcessEnv } from "../../../src/core/git-process-env";
import {
	completeTaskAndGetReadyLinkedTaskIds,
	moveTaskToColumn,
	updateTaskDependencies,
} from "../../../src/core/task-board-mutations";
import {
	applyNKleinPlanTaskGraphToBoard,
	applyNKleinPlanTaskReplacementArtifacts,
	createNKleinDecompositionTools,
	replaceNKleinPlanTaskInGraph,
} from "../../../src/nklein-agent/nklein-decomposition-tool";
import { NKLEIN_GUIDANCE_SKILL_TOPIC_MAP } from "../../../src/nklein-agent/nklein-guidance-skills";
import {
	type NKleinPlanTaskGraph,
	readNKleinPlanArtifacts,
	writeNKleinPlanArtifacts,
} from "../../../src/nklein-agent/nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../../../src/nklein-agent/nklein-task-router";
import { loadWorkspaceContext, loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";

const execFileAsync = promisify(execFile);

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createTaskGraph(): NKleinPlanTaskGraph {
	return {
		schemaVersion: 1,
		slug: "habit-tracker",
		title: "Habit Tracker",
		tasks: [
			{
				id: "storage",
				title: "Create storage",
				prompt: "Implement persistent storage.",
				dependsOn: [],
				complexity: 30,
				suggestedRole: "worker",
				filesLikelyTouched: ["src/storage.ts"],
				acceptanceCommand: "npm test",
				testFirst: false,
				acceptanceTestPrompt: null,
			},
			{
				id: "ui",
				title: "Create UI",
				prompt: "Implement the habit list UI.",
				dependsOn: ["storage"],
				complexity: 45,
				suggestedRole: "worker",
				filesLikelyTouched: ["src/App.tsx"],
				acceptanceCommand: "npm test",
				testFirst: false,
				acceptanceTestPrompt: null,
			},
		],
	};
}

function createRoutingCandidate(input: {
	key: string;
	role: string | null;
	capability: number;
	contextWindow: number;
	prefillTokensPerSecond?: number;
	decodeTokensPerSecond?: number;
}): NKleinTaskRoutingCandidate {
	return {
		role: input.role,
		entry: {
			key: input.key,
			providerId: "ollama",
			modelId: input.key,
			endpoint: null,
			contextWindow: {
				advertised: input.contextWindow,
				observed: null,
				userOverride: null,
				effective: input.contextWindow,
			},
			speed: {
				samples: 0,
				promptTokensEwma: null,
				outputTokensEwma: null,
				totalTokensEwma: null,
				prefillTokensPerSecondEwma: input.prefillTokensPerSecond ?? null,
				decodeTokensPerSecondEwma: input.decodeTokensPerSecond ?? null,
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
				staticPrior: input.capability,
				evalScore: null,
				externalScore: null,
				observedPassRate: null,
				effectiveScore: input.capability,
				lastObservedAt: null,
			},
			constraints: {
				sharedEndpointId: "ollama:default",
				inputCostPerMillionTokens: null,
				outputCostPerMillionTokens: null,
				maxConcurrentRequests: null,
			},
			createdAt: 1,
			updatedAt: 1,
		},
	};
}

describe("applyNKleinPlanTaskGraphToBoard", () => {
	it("creates planning cards and dependency links from a task graph", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		expect(result.createdTasks.map((task) => task.id)).toEqual(["habit-tracker-storage", "habit-tracker-ui"]);
		expect(result.rootTaskIds).toEqual(["habit-tracker-storage"]);
		expect(result.createdTasks[0]?.prompt).toContain("Likely files:");
		expect(result.createdTasks[0]?.prompt).toContain("Acceptance check: npm test");
		expect(result.createdTasks[0]?.filesLikelyTouched).toEqual(["src/storage.ts"]);
		expect(result.createdTasks[0]?.agentId).toBe("nklein");
		expect(result.createdTasks[0]?.generatedFromPlan).toEqual({
			artifactKind: "decomposition",
			planSlug: "habit-tracker",
			planTaskId: "storage",
			sourceTaskId: null,
		});
		expect(result.createdDependencies).toHaveLength(1);
		expect(result.createdDependencies[0]).toMatchObject({
			fromTaskId: "habit-tracker-ui",
			toTaskId: "habit-tracker-storage",
		});
		expect(result.board.dependencies).toEqual(result.createdDependencies);

		// §5.AU: the decomposition materializes ONE stream (epic) and stamps every generated card with its streamId.
		expect(result.board.streams).toEqual([
			{
				id: "stream-habit-tracker",
				title: "Habit Tracker",
				source: "decomposition",
				planSlug: "habit-tracker",
				createdAt: 100,
				updatedAt: 100,
			},
		]);
		expect(result.createdTasks.every((task) => task.streamId === "stream-habit-tracker")).toBe(true);
	});

	it("F1.9: copies the plan task's work-package bounds (writeScope/forbiddenPaths) onto the generated card", () => {
		const taskGraph = createTaskGraph();
		const first = taskGraph.tasks[0];
		if (!first) {
			throw new Error("expected a task");
		}
		first.writeScope = ["src/storage/**"];
		first.forbiddenPaths = ["src/ui/**"];
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph,
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});
		expect(result.createdTasks[0]?.writeScope).toEqual(["src/storage/**"]);
		expect(result.createdTasks[0]?.forbiddenPaths).toEqual(["src/ui/**"]);
		expect(result.createdTasks[1]?.writeScope).toBeUndefined(); // unbounded plan task stays unbounded
	});

	// Live-found 2026-07-02: a 120B architect decomposed `complex_dag` into a graph where EVERY card had a
	// dependency (incl. a 2-cycle), so `rootTaskIds` was empty and the auto-start cascade never began (dead board).
	// The apply path now breaks the minimal back-edges so there is always a startable root.
	it("breaks a cyclic architect graph so the board still has a startable root (regression: dead cascade)", () => {
		const cyclicGraph: NKleinPlanTaskGraph = {
			schemaVersion: 1,
			slug: "cyclic",
			title: "Cyclic Graph",
			tasks: [
				{
					id: "a",
					title: "A",
					prompt: "Do A.",
					dependsOn: ["b"], // a ↔ b: mutual dependency ⇒ no dependency-free root without repair
					complexity: 30,
					suggestedRole: "worker",
					filesLikelyTouched: ["src/a.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
				},
				{
					id: "b",
					title: "B",
					prompt: "Do B.",
					dependsOn: ["a"],
					complexity: 30,
					suggestedRole: "worker",
					filesLikelyTouched: ["src/b.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
				},
			],
		};
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: cyclicGraph,
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});
		// Both cards still materialize, but the cascade now has an entry point (root) and the broken edge is surfaced.
		expect(result.createdTasks).toHaveLength(2);
		expect(result.rootTaskIds.length).toBeGreaterThan(0);
		expect(result.brokenDependencyEdges).toHaveLength(1);
		// Exactly one direction of the cycle survives as a materialized dependency.
		expect(result.createdDependencies).toHaveLength(1);
	});

	// follow-up-6 §2.1: a generated DAG can look correct yet be operationally dead if cards land mis-laned or
	// mis-flagged so they cannot be started from Planning. Guard the startability preconditions directly.
	it("lands every generated card in Planning with start preconditions met (regression: startable from Planning)", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		const planningColumn = result.board.columns.find((column) => column.id === "planning");
		const planningIds = new Set((planningColumn?.cards ?? []).map((card) => card.id));
		// Every created card is in the Planning lane.
		for (const card of result.createdTasks) {
			expect(planningIds.has(card.id)).toBe(true);
			// Generated implementation cards must be runnable, not gated behind plan mode, and auto-reviewable.
			expect(card.startInPlanMode).toBe(false);
			expect(card.autoReviewEnabled).toBe(true);
			expect(card.agentId).toBe("nklein");
			expect(card.baseRef).toBe("main");
		}
		// Root cards are exactly the dependency-free generated cards and are immediately startable.
		const rootCards = result.createdTasks.filter((card) => result.rootTaskIds.includes(card.id));
		expect(result.rootTaskIds).toEqual(["habit-tracker-storage"]);
		for (const rootCard of rootCards) {
			const dependents = result.board.dependencies.filter((dependency) => dependency.fromTaskId === rootCard.id);
			expect(dependents).toHaveLength(0);
		}
	});

	it("links generated Planning cards so dependents become ready after their prerequisite completes", () => {
		const applied = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});
		const startedRoot = moveTaskToColumn(applied.board, "habit-tracker-storage", "in_progress", 200);
		const rootInReview = moveTaskToColumn(startedRoot.board, "habit-tracker-storage", "review", 300);
		const completedRoot = completeTaskAndGetReadyLinkedTaskIds(rootInReview.board, "habit-tracker-storage", 400);

		expect(updateTaskDependencies(startedRoot.board).dependencies).toEqual([
			expect.objectContaining({
				fromTaskId: "habit-tracker-ui",
				toTaskId: "habit-tracker-storage",
			}),
		]);
		expect(completedRoot.readyTaskIds).toEqual(["habit-tracker-ui"]);
	});

	it("includes shared plan spec and decisions in created card prompts", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			sharedContext: {
				spec: "# Spec\n\nKeep reminders out of the first release.",
				decisionsMarkdown: "# Decisions\n\n## q1\n\nAssumption: Sync is out of scope.",
			},
		});

		expect(result.createdTasks[0]?.prompt).toContain("Shared spec:");
		expect(result.createdTasks[0]?.prompt).toContain("Leaf scope:");
		expect(result.createdTasks[0]?.prompt).toContain(
			"not permission to implement dependent or downstream cards early",
		);
		expect(result.createdTasks[0]?.prompt).toContain("Keep reminders out of the first release.");
		expect(result.createdTasks[0]?.prompt).toContain("Shared decisions:");
		expect(result.createdTasks[0]?.prompt).toContain("Assumption: Sync is out of scope.");
	});

	it("injects matching guidance skill commands into generated card prompts", () => {
		const graph = createTaskGraph();
		const storageTask = graph.tasks[0];
		const uiTask = graph.tasks[1];
		if (!storageTask || !uiTask) {
			throw new Error("Expected tasks.");
		}
		graph.tasks = [
			{
				...storageTask,
				id: "guard-token-write",
				title: "Protect auth token writes",
				prompt: "Review credential handling before changing the auth token persistence path.",
				filesLikelyTouched: ["src/security/passcode-manager.ts"],
			},
			{
				...uiTask,
				id: "settings-panel",
				title: "Build settings panel",
				prompt: "Implement the settings UI panel.",
				dependsOn: ["guard-token-write"],
				filesLikelyTouched: ["web-ui/src/components/settings-panel.tsx"],
			},
			{
				...storageTask,
				id: "workspace-schema",
				title: "Tighten workspace schema",
				prompt: "Update the TypeScript contract for workspace state.",
				filesLikelyTouched: ["src/trpc/workspace-api.ts"],
			},
			{
				...storageTask,
				id: "release-notes",
				title: "Update release notes",
				prompt: "Update the release notes.",
				filesLikelyTouched: ["docs/release-notes.md"],
			},
		];

		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: graph,
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		expect(NKLEIN_GUIDANCE_SKILL_TOPIC_MAP.ui.skillFile).toBe("skills/nklein-ui/SKILL.md");
		expect(result.createdTasks[0]?.prompt).toMatch(
			new RegExp(`^/${NKLEIN_GUIDANCE_SKILL_TOPIC_MAP.security.commandName}`),
		);
		expect(result.createdTasks[0]?.prompt).toContain("Guidance topic: security");
		expect(result.createdTasks[1]?.prompt).toMatch(new RegExp(`^/${NKLEIN_GUIDANCE_SKILL_TOPIC_MAP.ui.commandName}`));
		expect(result.createdTasks[1]?.prompt).toContain("Guidance topic: ui");
		expect(result.createdTasks[2]?.prompt).toMatch(new RegExp(`^/${NKLEIN_GUIDANCE_SKILL_TOPIC_MAP.ts.commandName}`));
		expect(result.createdTasks[2]?.prompt).toContain("Guidance topic: ts");
		expect(result.createdTasks[3]?.prompt).not.toContain("/nklein-");
	});

	it("keeps board task ids unique when plan ids slugify to the same value", () => {
		const graph = createTaskGraph();
		const storageTask = graph.tasks[0];
		const uiTask = graph.tasks[1];
		if (!storageTask || !uiTask) {
			throw new Error("Expected tasks.");
		}
		graph.tasks = [
			{ ...storageTask, id: "build.ui" },
			{ ...uiTask, id: "build-ui", dependsOn: ["build.ui"] },
		];

		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: graph,
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		expect(result.createdTasks.map((task) => task.id)).toEqual([
			"habit-tracker-build-ui",
			"habit-tracker-build-ui-2",
		]);
		expect(result.createdDependencies[0]).toMatchObject({
			fromTaskId: "habit-tracker-build-ui-2",
			toTaskId: "habit-tracker-build-ui",
		});
	});

	it("reuses generated cards and dependencies when a graph is applied more than once", () => {
		const firstApply = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		const secondApply = applyNKleinPlanTaskGraphToBoard({
			board: firstApply.board,
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 200,
		});

		expect(secondApply.createdTasks).toEqual([]);
		expect(secondApply.createdDependencies).toEqual([]);
		expect(secondApply.taskIdByPlanTaskId).toEqual({
			storage: "habit-tracker-storage",
			ui: "habit-tracker-ui",
		});
		expect(secondApply.board).toEqual(firstApply.board);
	});

	// Regression: idempotent re-apply must survive a prerequisite card advancing past the waiting lanes. Board
	// evolution between applies is normal (a card gets worked and completed); moveTaskToColumn(completed) strips the
	// ui->storage edge, so re-linking on re-apply returns reason `trash_task`. The old relink loop threw
	// `Could not link ui to storage: trash_task`, aborting the ENTIRE re-apply (CLI/tRPC surfaces the error). The
	// re-apply-benign reasons (trash_task / non_backlog) must be skipped like `duplicate`.
	it("re-applies without throwing after a prerequisite card has moved to completed (regression: relink abort)", () => {
		const firstApply = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});
		// The prerequisite (storage) is worked and completed; this strips the ui->storage dependency edge.
		const storageCompleted = moveTaskToColumn(firstApply.board, "habit-tracker-storage", "completed", 200);

		const secondApply = applyNKleinPlanTaskGraphToBoard({
			board: storageCompleted.board,
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 300,
		});

		// No throw; a benign no-op re-apply — no new cards, and the (now-unblockable) edge is not re-created.
		expect(secondApply.createdTasks).toEqual([]);
		expect(secondApply.createdDependencies).toEqual([]);
		expect(secondApply.taskIdByPlanTaskId).toEqual({
			storage: "habit-tracker-storage",
			ui: "habit-tracker-ui",
		});
	});

	it("records the source task id on generated cards when provided", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			sourceTaskId: "planning-card",
			now: 100,
		});

		expect(result.createdTasks[0]?.generatedFromPlan).toEqual({
			artifactKind: "decomposition",
			planSlug: "habit-tracker",
			planTaskId: "storage",
			sourceTaskId: "planning-card",
		});
	});

	it("moves an applied decomposition source card out of Planning", () => {
		const board = createBoard();
		board.columns[1]?.cards.push({
			id: "planning-card",
			title: "Complex product decomposition",
			prompt: "Break this product into implementation cards.",
			startInPlanMode: true,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});

		const result = applyNKleinPlanTaskGraphToBoard({
			board,
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			sourceTaskId: "planning-card",
			now: 100,
		});

		const planningCards = result.board.columns.find((column) => column.id === "planning")?.cards ?? [];
		const completedCards = result.board.columns.find((column) => column.id === "completed")?.cards ?? [];
		expect(new Set(planningCards.map((card) => card.id))).toEqual(
			new Set(["habit-tracker-storage", "habit-tracker-ui"]),
		);
		expect(completedCards.map((card) => card.id)).toEqual(["planning-card"]);
		expect(completedCards[0]?.updatedAt).toBe(100);
	});

	it("carries test-first decomposition instructions into created card prompts", () => {
		const graph = createTaskGraph();
		const storageTask = graph.tasks[0];
		if (!storageTask) {
			throw new Error("Expected storage task.");
		}
		graph.tasks[0] = {
			...storageTask,
			testFirst: true,
			acceptanceTestPrompt: "Add a failing storage persistence test before changing src/storage.ts.",
		};

		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: graph,
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		expect(result.createdTasks[0]?.prompt).toContain(
			"Test-first: write or update the acceptance test before implementation.",
		);
		expect(result.createdTasks[0]?.prompt).toContain("Add a failing storage persistence test");
	});

	it("applies NKlein settings from suggested task roles", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			modelRoleSettings: {
				worker: {
					providerId: "ollama",
					modelId: "qwen3.5-9b",
					reasoningEffort: "medium",
				},
			},
		});

		expect(result.createdTasks[0]?.nkleinSettings).toEqual({
			...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			reasoningEffort: "medium",
		});
		expect(result.createdTasks[1]?.nkleinSettings).toEqual({
			...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			reasoningEffort: "medium",
		});
	});

	it("writes the routed role settings when a task routes above its suggested role", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			modelRoleSettings: {
				worker: {
					providerId: "ollama",
					modelId: "qwen3.5-9b",
					reasoningEffort: "low",
				},
				architect: {
					providerId: "lmstudio",
					modelId: "deepseek-coder-33b",
					reasoningEffort: "high",
				},
			},
			routingCandidates: [
				createRoutingCandidate({
					key: "qwen3.5-9b",
					role: "worker",
					capability: 35,
					contextWindow: 64_000,
					prefillTokensPerSecond: 200,
					decodeTokensPerSecond: 20,
				}),
				createRoutingCandidate({
					key: "deepseek-coder-33b",
					role: "architect",
					capability: 70,
					contextWindow: 64_000,
					prefillTokensPerSecond: 100,
					decodeTokensPerSecond: 10,
				}),
			],
		});

		expect(result.createdTasks[0]?.nkleinSettings).toEqual({
			...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			reasoningEffort: "low",
		});
		expect(result.createdTasks[0]?.prompt).toContain(
			"Model fit: validated by !Klein routing guard (ollama / qwen3.5-9b, role worker, context 64,000, capability 35)",
		);
		expect(result.createdTasks[1]?.nkleinSettings).toEqual({
			...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
			// The SELECTED candidate's model is pinned so the card RUNS on it (§5.AB), with the role's non-model settings
			// (reasoningEffort) layered on. The candidate's provider is `ollama` (what the router evaluated — see the fit
			// evidence below); in production a role candidate is built FROM the role's launch config so the two agree — this
			// fixture decouples them (role config says lmstudio) to prove the SELECTED model wins, not the config lookup.
			providerId: "ollama",
			modelId: "deepseek-coder-33b",
			reasoningEffort: "high",
		});
		expect(result.createdTasks[1]?.prompt).toContain(
			"Model fit: validated by !Klein routing guard (ollama / deepseek-coder-33b, role architect, context 64,000, capability 70)",
		);
		expect(result.preview.summary).toContain("across 2 cards");
		expect(result.preview.tasks[0]).toMatchObject({
			planTaskId: "storage",
			modelLabel: "ollama/qwen3.5-9b",
			estimatedWallTimeMs: expect.any(Number),
		});
	});

	it("pins the SELECTED default model, not the suggested role's settings, when routing selects the default", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			modelRoleSettings: {
				worker: {
					providerId: "ollama",
					modelId: "qwen3.5-9b",
				},
			},
			routingCandidates: [
				createRoutingCandidate({
					key: "default-local",
					role: null,
					capability: 80,
					contextWindow: 64_000,
				}),
			],
		});

		// Routing selected the role-less default candidate → the card is pinned to THAT model (so it runs on the selected
		// model, §5.AB), NOT the suggested worker role's qwen3.5-9b (the anti-leak intent this test guards).
		const expected = { ...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS, providerId: "ollama", modelId: "default-local" };
		expect(result.createdTasks[0]?.nkleinSettings).toEqual(expected);
		expect(result.createdTasks[1]?.nkleinSettings).toEqual(expected);
	});

	it("rejects unknown dependency references", () => {
		const graph = createTaskGraph();
		const uiTask = graph.tasks[1];
		if (!uiTask) {
			throw new Error("Expected UI task.");
		}
		graph.tasks[1] = {
			...uiTask,
			dependsOn: ["missing"],
		};

		expect(() =>
			applyNKleinPlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: graph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("depends on unknown task");
	});

	it("rejects tasks without acceptance checks", () => {
		const graph = createTaskGraph();
		const storageTask = graph.tasks[0];
		if (!storageTask) {
			throw new Error("Expected storage task.");
		}
		graph.tasks[0] = {
			...storageTask,
			acceptanceCommand: null,
		};

		expect(() =>
			applyNKleinPlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: graph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("missing an acceptanceCommand");
	});

	it("normalizes test-first tasks without acceptance test instructions back to normal execution", () => {
		const graph = createTaskGraph();
		const storageTask = graph.tasks[0];
		if (!storageTask) {
			throw new Error("Expected storage task.");
		}
		graph.tasks[0] = {
			...storageTask,
			testFirst: true,
			acceptanceTestPrompt: "",
		};

		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: graph,
			baseRef: "main",
			randomUuid: () => "unused",
		});

		expect(result.createdTasks[0]?.prompt).not.toContain("Test-first acceptance:");
	});

	it("rejects oversized task leaves by complexity and likely file count", () => {
		const complexGraph = createTaskGraph();
		const storageTask = complexGraph.tasks[0];
		if (!storageTask) {
			throw new Error("Expected storage task.");
		}
		complexGraph.tasks[0] = {
			...storageTask,
			complexity: 90,
		};
		expect(() =>
			applyNKleinPlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: complexGraph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("split it below 75/100");

		const broadGraph = createTaskGraph();
		const uiTask = broadGraph.tasks[1];
		if (!uiTask) {
			throw new Error("Expected UI task.");
		}
		broadGraph.tasks[1] = {
			...uiTask,
			filesLikelyTouched: ["src/App.tsx", "src/storage.ts", "src/sync.ts", "src/styles.css"],
		};
		expect(() =>
			applyNKleinPlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: broadGraph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("3 files or fewer");
	});

	it("accepts sized leaves that pass the model feasibility guard", () => {
		const result = applyNKleinPlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			routingCandidates: [
				createRoutingCandidate({
					key: "qwen3.5-9b",
					role: "worker",
					capability: 65,
					contextWindow: 32_000,
				}),
			],
		});

		expect(result.createdTasks).toHaveLength(2);
	});

	it("rejects leaves that no connected model can route", () => {
		const graph = createTaskGraph();
		const uiTask = graph.tasks[1];
		if (!uiTask) {
			throw new Error("Expected UI task.");
		}
		graph.tasks[1] = {
			...uiTask,
			complexity: 70,
		};

		expect(() =>
			applyNKleinPlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: graph,
				baseRef: "main",
				randomUuid: () => "unused",
				routingCandidates: [
					createRoutingCandidate({
						key: "tiny-local",
						role: "worker",
						capability: 35,
						contextWindow: 8_000,
					}),
				],
			}),
		).toThrow("failed the model feasibility guard");
	});
});

describe("nklein decomposition tools", () => {
	function getTool(
		name: string,
		workspacePath: string,
		sourceTaskId?: string | null,
		artifactWorkspacePath?: string | null,
		onApplied?: Parameters<typeof createNKleinDecompositionTools>[0]["onApplied"],
	) {
		const tool = createNKleinDecompositionTools({
			workspacePath,
			sourceTaskId,
			artifactWorkspacePath,
			onApplied,
		}).find((candidate) => candidate.name === name);
		if (!tool) {
			throw new Error(`Missing tool ${name}`);
		}
		return tool;
	}

	it("W4.3: a high-stakes warning-bearing plan gets ONE diverse-critic round; revise bounces, the revision applies without re-critique", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-critique-"));
		const requestPlanCritique = vi.fn().mockResolvedValueOnce({
			verdict: "revise",
			summary: "Coupling is missing.",
			feedback: "Wire storage before the UI card.",
		});
		const tool = createNKleinDecompositionTools({ workspacePath, requestPlanCritique }).find(
			(candidate) => candidate.name === "decompose_project",
		);
		if (!tool) {
			throw new Error("missing decompose_project");
		}
		// 5 tasks, one edge ⇒ high stakes (≥4 tasks) + sparse-graph quality warnings (not clean ⇒ medium confidence).
		const input = {
			slug: "critique-plan",
			title: "Critique plan",
			spec: "Five loosely-coupled slices.",
			plan: "Slices.",
			summary: "Five cards.",
			defaultAcceptanceCommand: "npm test",
			tasks: [
				{ id: "a", title: "Card a", prompt: "Do a." },
				{ id: "b", title: "Card b", prompt: "Do b.", dependsOn: ["a"] },
				{ id: "c", title: "Card c", prompt: "Do c." },
				{ id: "d", title: "Card d", prompt: "Do d." },
				{ id: "e", title: "Card e", prompt: "Do e." },
			],
		};
		await expect(tool.execute(input, undefined as never)).rejects.toThrow(/Wire storage before the UI card/);
		expect(requestPlanCritique).toHaveBeenCalledTimes(1);
		expect(requestPlanCritique.mock.calls[0]?.[0]).toMatchObject({
			slug: "critique-plan",
			qualityWarnings: expect.arrayContaining([expect.stringContaining("sparse")]),
		});

		// The REVISED call (same slug) must NOT re-critique — one round per plan, then it applies.
		const revised = (await tool.execute(input, undefined as never)) as { ok: boolean };
		expect(revised.ok).toBe(true);
		expect(requestPlanCritique).toHaveBeenCalledTimes(1);
	});

	it("W4.3: a proceed verdict (or a null/absent critic) never blocks the decomposition", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-critique-ok-"));
		const requestPlanCritique = vi.fn().mockResolvedValue({ verdict: "proceed", summary: "Sound.", feedback: null });
		const tool = createNKleinDecompositionTools({ workspacePath, requestPlanCritique }).find(
			(candidate) => candidate.name === "decompose_project",
		);
		if (!tool) {
			throw new Error("missing decompose_project");
		}
		const input = {
			slug: "proceed-plan",
			title: "Proceed plan",
			spec: "Five slices.",
			plan: "Slices.",
			summary: "Five cards.",
			defaultAcceptanceCommand: "npm test",
			tasks: [
				{ id: "a", title: "Card a", prompt: "Do a." },
				{ id: "b", title: "Card b", prompt: "Do b.", dependsOn: ["a"] },
				{ id: "c", title: "Card c", prompt: "Do c." },
				{ id: "d", title: "Card d", prompt: "Do d." },
				{ id: "e", title: "Card e", prompt: "Do e." },
			],
		};
		const result = (await tool.execute(input, undefined as never)) as { ok: boolean };
		expect(result.ok).toBe(true);
		expect(requestPlanCritique).toHaveBeenCalledTimes(1);

		// A small flat plan never deliberates at all (low stakes).
		const small = (await tool.execute(
			{
				slug: "small-plan",
				title: "Small plan",
				spec: "Two slices.",
				plan: "Slices.",
				summary: "Two cards.",
				defaultAcceptanceCommand: "npm test",
				tasks: [
					{ id: "x", title: "Card x", prompt: "Do x." },
					{ id: "y", title: "Card y", prompt: "Do y.", dependsOn: ["x"] },
				],
			},
			undefined as never,
		)) as { ok: boolean };
		expect(small.ok).toBe(true);
		expect(requestPlanCritique).toHaveBeenCalledTimes(1);
	});

	it("writes validated plan artifacts from decompose_project", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-tools-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				summary: "Build the habit tracker in two cards: storage first, then UI.",
				questions: [
					{
						id: "q1",
						question: "Should reminders be included in the first slice?",
						status: "assumed-default",
						options: [
							{
								id: "no",
								label: "No reminders",
								description: "Keep the initial implementation focused.",
								recommended: true,
							},
						],
						assumption: "Reminders are out of scope for the first slice.",
					},
				],
				tasks: createTaskGraph().tasks,
			},
			undefined as never,
		)) as {
			ok: boolean;
			slug: string;
			taskCount: number;
			applied: boolean;
			createdTaskCount: number;
			modelFitValidated: boolean;
			questionsPath: string;
			decisionsPath: string;
			revisionsPath: string;
			summaryPath: string;
			taskGraphPath: string;
			instruction: string;
		};

		expect(result.ok).toBe(true);
		expect(result.slug).toBe("habit-tracker");
		expect(result.taskCount).toBe(2);
		expect(result.applied).toBe(false);
		expect(result.createdTaskCount).toBe(0);
		expect(result.modelFitValidated).toBe(false);
		expect(result.instruction).toContain("nklein task decompose --slug habit-tracker");
		expect(result.instruction).toContain("Apply them through !Klein, not by editing task files");
		expect(result.instruction).toContain("connected local model fit was not validated in this tool call");
		expect(result.instruction).toContain("connected-model fit is checked during apply/start");
		await expect(readFile(join(workspacePath, result.questionsPath), "utf8")).resolves.toContain(
			"Reminders are out of scope",
		);
		await expect(readFile(join(workspacePath, result.decisionsPath), "utf8")).resolves.toContain(
			"Reminders are out of scope",
		);
		await expect(readFile(join(workspacePath, result.revisionsPath), "utf8")).resolves.toContain("No plan revisions");
		await expect(readFile(join(workspacePath, result.summaryPath), "utf8")).resolves.toContain("two cards");
		await expect(readFile(join(workspacePath, result.taskGraphPath), "utf8")).resolves.toContain(
			'"slug": "habit-tracker"',
		);
	});

	it("never leaks the host workspace path into the agent-facing decompose result (AGENTS.md isolation)", async () => {
		// Agents must never see host details: plan artifacts are written host-side, but the decompose tool's
		// return value is the agent-facing tool result. Every path it surfaces must be workspace-relative, and no
		// instruction string may embed the absolute host workspace path. Locks the §5.A HARDEN host-path-leak fix.
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-host-leak-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				summary: "Build the habit tracker in two cards.",
				tasks: createTaskGraph().tasks,
			},
			undefined as never,
		)) as {
			specPath: string;
			planPath: string;
			questionsPath: string;
			decisionsPath: string;
			revisionsPath: string;
			summaryPath: string;
			taskGraphPath: string;
			instruction: string;
		};

		const pathFields = [
			result.specPath,
			result.planPath,
			result.questionsPath,
			result.decisionsPath,
			result.revisionsPath,
			result.summaryPath,
			result.taskGraphPath,
		];
		for (const value of pathFields) {
			// Workspace-relative (not absolute), under the plan artifacts dir, and free of the host mount path.
			expect(value).not.toContain(workspacePath);
			expect(value.startsWith("/")).toBe(false);
			expect(value).toContain(".nklein/nklein/plans/habit-tracker/");
		}
		// The instruction text must not embed the host workspace path either.
		expect(result.instruction).not.toContain(workspacePath);
		// The CLI hint must not surface a host `--project-path <absolute>` argument to the agent.
		expect(result.instruction).not.toContain("--project-path");
	});

	it("accepts stringified task arrays from small-model decompose_project calls", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-string-tasks-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				summary: "Build the habit tracker in two cards.",
				tasks: JSON.stringify(createTaskGraph().tasks),
			},
			undefined as never,
		)) as {
			ok: boolean;
			taskCount: number;
			taskGraphPath: string;
		};

		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
		await expect(readFile(join(workspacePath, result.taskGraphPath), "utf8")).resolves.toContain('"id": "storage"');
	});

	it("recovers stringified task arrays with stray trailing closing braces", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-string-tasks-trailing-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				summary: "Build the habit tracker in two cards.",
				tasks: `${JSON.stringify(createTaskGraph().tasks)}}`,
			},
			undefined as never,
		)) as {
			ok: boolean;
			taskCount: number;
			taskGraphPath: string;
		};

		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
		await expect(readFile(join(workspacePath, result.taskGraphPath), "utf8")).resolves.toContain('"id": "storage"');
	});

	it("advertises stringified decomposition payloads in the tool schema", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-string-schema-"));
		const tool = getTool("decompose_project", workspacePath);
		const inputProperties = tool.inputSchema.properties as Record<string, unknown>;
		const tasksSchema = inputProperties.tasks as { anyOf?: readonly Record<string, unknown>[] };
		const expansionsSchema = inputProperties.expansions as { anyOf?: readonly Record<string, unknown>[] };
		const questionsSchema = inputProperties.questions as {
			items?: { properties?: Record<string, { type?: unknown }> };
		};
		const taskArraySchema = tasksSchema.anyOf?.find((schema) => schema.type === "array") as
			| { items?: { properties?: Record<string, { type?: unknown }> } }
			| undefined;

		expect(tasksSchema.anyOf).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "array" }),
				expect.objectContaining({ type: "string" }),
			]),
		);
		expect(expansionsSchema.anyOf).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "object" }),
				expect.objectContaining({ type: "string" }),
			]),
		);
		expect(questionsSchema.items?.properties?.answer?.type).toEqual(["string", "null"]);
		expect(questionsSchema.items?.properties?.assumption?.type).toEqual(["string", "null"]);
		expect(taskArraySchema?.items?.properties?.suggestedRole?.type).toEqual(["string", "null"]);
		expect(taskArraySchema?.items?.properties?.acceptanceCommand?.type).toEqual(["string", "null"]);
		expect(taskArraySchema?.items?.properties?.acceptanceTestPrompt?.type).toEqual(["string", "null"]);
	});

	it("rejects decompose_project plans below the requested minimum task count", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-minimum-"));
		const tool = getTool("decompose_project", workspacePath);

		await expect(
			tool.execute(
				{
					slug: "Habit Tracker",
					title: "Habit Tracker",
					spec: "Track habits.",
					plan: "Build storage before UI.",
					minimumTaskCount: 3,
					tasks: createTaskGraph().tasks,
				},
				undefined as never,
			),
		).rejects.toThrow("requires at least 3 task leaves; received 2");
	});

	it("recovers an open clarifying question with no working default by adding a conservative assumption", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-open-questions-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				questions: [
					{
						id: "q1",
						question: "Should reminders be included?",
						status: "open",
					},
				],
				tasks: createTaskGraph().tasks,
			},
			undefined as never,
		)) as { ok: boolean; questionsPath: string; decisionsPath: string };

		expect(result.ok).toBe(true);
		const questions = await readFile(join(workspacePath, result.questionsPath), "utf8");
		const decisions = await readFile(join(workspacePath, result.decisionsPath), "utf8");
		expect(questions).toContain("Assuming the current project/specification context provides the working default");
		expect(decisions).toContain("Should reminders be included?");
	});

	it("accepts an open clarifying question that carries a working assumption (stays open for clarification)", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-open-assumption-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				summary: "Build the habit tracker in two cards.",
				questions: [
					{
						id: "reminders",
						question: "Should reminders be included?",
						status: "open",
						assumption: "Assume reminders are in scope (sensible default to plan against).",
					},
				],
				tasks: createTaskGraph().tasks,
			},
			undefined as never,
		)) as { ok: boolean };

		expect(result.ok).toBe(true);
	});

	it("applies decompose_project artifacts to a Git-backed !Klein workspace", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-apply-"));
		const homePath = await mkdtemp(join(tmpdir(), "kanban-decompose-home-"));
		const previousHome = process.env.HOME;
		process.env.HOME = homePath;
		try {
			await execFileAsync("git", ["init"], { cwd: workspacePath, env: createGitProcessEnv() });
			await execFileAsync("git", ["commit", "--allow-empty", "-m", "Initial"], {
				cwd: workspacePath,
				env: {
					...createGitProcessEnv(),
					GIT_AUTHOR_NAME: "!Klein Test",
					GIT_AUTHOR_EMAIL: "kanban-test@example.invalid",
					GIT_COMMITTER_NAME: "!Klein Test",
					GIT_COMMITTER_EMAIL: "kanban-test@example.invalid",
				},
			});
			const onApplied = vi.fn(async () => {});
			const tool = getTool("decompose_project", workspacePath, undefined, undefined, onApplied);

			const result = (await tool.execute(
				{
					slug: "Habit Tracker",
					title: "Habit Tracker",
					spec: "Track habits.",
					plan: "Build storage before UI.",
					tasks: createTaskGraph().tasks,
				},
				undefined as never,
			)) as {
				ok: boolean;
				artifactId: string;
				applied: boolean;
				createdTaskCount: number;
				createdDependencyCount: number;
				taskIdByPlanTaskId: Record<string, string>;
				rootTaskIds: string[];
				modelFitValidated: boolean;
				instruction: string;
				preview: {
					summary: string;
					taskCount: number;
				};
			};

			expect(result.ok).toBe(true);
			expect(result.artifactId).toBe("decomposition:habit-tracker");
			expect(result.applied).toBe(true);
			expect(result.createdTaskCount).toBe(2);
			expect(result.createdDependencyCount).toBe(1);
			expect(result.modelFitValidated).toBe(false);
			expect(result.taskIdByPlanTaskId).toMatchObject({
				storage: "habit-tracker-storage",
				ui: "habit-tracker-ui",
			});
			expect(result.rootTaskIds).toEqual(["habit-tracker-storage"]);
			expect(onApplied).toHaveBeenCalledWith({
				workspacePath,
				sourceTaskId: null,
				planSlug: "habit-tracker",
				rootTaskIds: ["habit-tracker-storage"],
				taskIdByPlanTaskId: {
					storage: "habit-tracker-storage",
					ui: "habit-tracker-ui",
				},
			});
			expect(result.instruction).toContain("created 2 Planning cards and 1 dependency");
			expect(result.instruction).toContain("Dry-run preview:");
			expect(result.instruction).toContain("do not try to inspect them");
			expect(result.instruction).toContain("Stop this planning card now");
			expect(result.preview.taskCount).toBe(2);
			expect(result.preview.summary).toContain("across 2 cards");
			expect(result.instruction).toContain("connected local model fit will be enforced when each card starts");
			expect(result.instruction).not.toContain("nklein task decompose");

			const state = await loadWorkspaceState(workspacePath);
			const planningCards = state.board.columns.find((column) => column.id === "planning")?.cards ?? [];
			expect(new Set(planningCards.map((card) => card.id))).toEqual(
				new Set(["habit-tracker-storage", "habit-tracker-ui"]),
			);
			expect(planningCards.find((card) => card.id === "habit-tracker-storage")?.generatedFromPlan).toEqual({
				artifactKind: "decomposition",
				planSlug: "habit-tracker",
				planTaskId: "storage",
				sourceTaskId: null,
			});
			expect(planningCards.find((card) => card.id === "habit-tracker-storage")?.prompt).toContain("Execution pace");
			expect(state.board.dependencies).toHaveLength(1);
			const artifacts = await readNKleinPlanArtifacts(workspacePath, "habit-tracker");
			expect(artifacts.metadata.applicationStatus).toBe("applied");
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	it("applies a task-worktree decompose_project run to the parent workspace board", async () => {
		const parentWorkspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-parent-"));
		const homePath = await mkdtemp(join(tmpdir(), "kanban-decompose-home-"));
		const taskWorktreePath = join(homePath, ".nklein", "worktrees", "source-card", "kanban-decompose-parent");
		const previousHome = process.env.HOME;
		process.env.HOME = homePath;
		try {
			await mkdir(taskWorktreePath, { recursive: true });
			await execFileAsync("git", ["init"], { cwd: parentWorkspacePath, env: createGitProcessEnv() });
			await execFileAsync("git", ["commit", "--allow-empty", "-m", "Initial"], {
				cwd: parentWorkspacePath,
				env: {
					...createGitProcessEnv(),
					GIT_AUTHOR_NAME: "!Klein Test",
					GIT_AUTHOR_EMAIL: "kanban-test@example.invalid",
					GIT_COMMITTER_NAME: "!Klein Test",
					GIT_COMMITTER_EMAIL: "kanban-test@example.invalid",
				},
			});
			await execFileAsync("git", ["init"], { cwd: taskWorktreePath, env: createGitProcessEnv() });
			await loadWorkspaceContext(parentWorkspacePath);
			const sourceBoard = createBoard();
			sourceBoard.columns[0]?.cards.push({
				id: "source-card",
				title: "Complex product decomposition",
				prompt: "Generate the implementation DAG.",
				startInPlanMode: true,
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			});
			await saveWorkspaceState(parentWorkspacePath, {
				board: sourceBoard,
				sessions: {},
			});
			const tasks = Array.from({ length: 10 }, (_, index) => ({
				id: `slice-${index + 1}`,
				title: `Slice ${index + 1}`,
				prompt: `Implement slice ${index + 1}.`,
				dependsOn: index === 0 ? [] : [`slice-${index}`],
				complexity: 20,
				suggestedRole: "worker",
				filesLikelyTouched: [`src/slice-${index + 1}.ts`],
				acceptanceCommand: "npm test",
				testFirst: false,
				acceptanceTestPrompt: null,
			}));
			const tool = getTool("decompose_project", taskWorktreePath, "source-card", parentWorkspacePath);

			const result = (await tool.execute(
				{
					slug: "Complex Product",
					title: "Complex Product",
					spec: "Build a complex product in small slices.",
					plan: "Create ten ordered implementation slices.",
					tasks,
				},
				undefined as never,
			)) as {
				ok: boolean;
				applied: boolean;
				createdTaskCount: number;
				createdDependencyCount: number;
			};

			expect(result.ok).toBe(true);
			expect(result.applied).toBe(true);
			expect(result.createdTaskCount).toBe(10);
			expect(result.createdDependencyCount).toBe(9);
			const parentState = await loadWorkspaceState(parentWorkspacePath);
			const planningCards = parentState.board.columns.find((column) => column.id === "planning")?.cards ?? [];
			const completedCards = parentState.board.columns.find((column) => column.id === "completed")?.cards ?? [];
			expect(planningCards).toHaveLength(10);
			expect(completedCards.map((card) => card.id)).toEqual(["source-card"]);
			expect(planningCards.every((card) => card.generatedFromPlan?.sourceTaskId === "source-card")).toBe(true);
			await expect(readNKleinPlanArtifacts(parentWorkspacePath, "complex-product")).resolves.toMatchObject({
				metadata: {
					applicationStatus: "applied",
					sourceTaskId: "source-card",
				},
			});
			await expect(
				readFile(join(taskWorktreePath, ".nklein", "nklein", "plans", "complex-product", "tasks.json")),
			).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	it("keeps decompose_project artifacts pending when auto-apply is disabled", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-pending-"));
		const homePath = await mkdtemp(join(tmpdir(), "kanban-decompose-home-"));
		const previousHome = process.env.HOME;
		process.env.HOME = homePath;
		try {
			await mkdir(join(homePath, ".nklein", "nklein"), { recursive: true });
			await writeFile(
				join(homePath, ".nklein", "nklein", "config.json"),
				JSON.stringify({ decompositionAutoApplyEnabled: false }),
				"utf8",
			);
			await execFileAsync("git", ["init"], { cwd: workspacePath, env: createGitProcessEnv() });
			await execFileAsync("git", ["commit", "--allow-empty", "-m", "Initial"], {
				cwd: workspacePath,
				env: {
					...createGitProcessEnv(),
					GIT_AUTHOR_NAME: "!Klein Test",
					GIT_AUTHOR_EMAIL: "kanban-test@example.invalid",
					GIT_COMMITTER_NAME: "!Klein Test",
					GIT_COMMITTER_EMAIL: "kanban-test@example.invalid",
				},
			});
			const tool = getTool("decompose_project", workspacePath, "source-card");

			const result = (await tool.execute(
				{
					slug: "Habit Tracker",
					title: "Habit Tracker",
					spec: "Track habits.",
					plan: "Build storage before UI.",
					tasks: createTaskGraph().tasks,
				},
				undefined as never,
			)) as {
				applied: boolean;
				createdTaskCount: number;
				createdDependencyCount: number;
				instruction: string;
			};

			expect(result.applied).toBe(false);
			expect(result.createdTaskCount).toBe(0);
			expect(result.createdDependencyCount).toBe(0);
			expect(result.instruction).toContain("Automatic card creation is disabled");
			const state = await loadWorkspaceState(workspacePath);
			expect(state.board.columns.find((column) => column.id === "planning")?.cards).toHaveLength(0);
			const artifacts = await readNKleinPlanArtifacts(workspacePath, "habit-tracker");
			expect(artifacts.metadata.applicationStatus).toBe("pending");
			expect(artifacts.metadata.sourceTaskId).toBe("source-card");
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	it("records telemetry when decompose_project artifacts cannot auto-apply", async () => {
		selfObservationMocks.recordSelfObservation.mockReset();
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-apply-failure-"));
		const tool = getTool("decompose_project", workspacePath, "source-card");

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				tasks: createTaskGraph().tasks,
			},
			undefined as never,
		)) as {
			applied: boolean;
			createdTaskCount: number;
			createdDependencyCount: number;
			instruction: string;
		};

		expect(result.applied).toBe(false);
		expect(result.createdTaskCount).toBe(0);
		expect(result.createdDependencyCount).toBe(0);
		expect(result.instruction).toContain("Could not apply the task graph automatically");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "runtime_error",
				severity: "warning",
				taskId: "source-card",
				workspacePath,
				message: expect.stringContaining("Plan artifact auto-apply failed:"),
				metadata: expect.objectContaining({
					operation: "decompose_project_auto_apply",
					planSlug: "habit-tracker",
					taskCount: 2,
				}),
			}),
		);
	});

	it("accepts simplified task lists in decompose_project", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-simple-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				defaultAcceptanceCommand: "npm test",
				tasks: [
					{
						id: "storage",
						title: "Build storage",
						prompt: "Implement the storage slice.",
						complexity: 35,
						filesLikelyTouched: ["src/storage.ts"],
						acceptanceCommand: "grep -q storage src/storage.ts",
					},
					{
						id: "ui",
						title: "Build UI",
						prompt: "Implement the UI slice.",
						dependsOn: ["storage"],
						complexity: 45,
						filesLikelyTouched: ["src/ui.ts"],
					},
				],
			},
			undefined as never,
		)) as {
			ok: boolean;
			taskCount: number;
			taskGraphPath: string;
		};

		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
		const taskGraph = await readFile(join(workspacePath, result.taskGraphPath), "utf8");
		expect(taskGraph).toContain('"schemaVersion": 1');
		// FILL-ONLY (2026-07-05 decision): "storage" keeps its own acceptanceCommand; "ui" (which omitted one) fills
		// from defaultAcceptanceCommand.
		expect(taskGraph).toContain("grep -q storage src/storage.ts");
		expect(taskGraph).toContain('"acceptanceCommand": "npm test"');
		expect(taskGraph).toContain('"dependsOn": [');
	});

	it("recursively expands oversized tasks in decompose_project before writing artifacts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-recursive-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				title: "Habit Tracker",
				spec: "Track habits.",
				plan: "Split a broad feature into executable leaves.",
				defaultAcceptanceCommand: "npm test",
				tasks: [
					{
						id: "feature",
						title: "Build habit tracking feature",
						prompt: "Implement the whole feature.",
						complexity: 95,
						filesLikelyTouched: ["src/storage.ts", "src/App.tsx", "src/sync.ts", "src/styles.css"],
					},
					{
						id: "release",
						title: "Release wiring",
						prompt: "Wire the final release path.",
						dependsOn: ["feature"],
						complexity: 20,
						filesLikelyTouched: ["src/release.ts"],
					},
				],
				expansions: {
					feature: [
						{
							id: "storage",
							title: "Build storage",
							prompt: "Implement habit persistence.",
							complexity: 35,
							filesLikelyTouched: ["src/storage.ts"],
						},
						{
							id: "ui",
							title: "Build UI",
							prompt: "Implement the broad UI.",
							dependsOn: ["storage"],
							complexity: 90,
							filesLikelyTouched: ["src/App.tsx", "src/styles.css", "src/routes.tsx", "src/state.ts"],
						},
					],
					ui: [
						{
							id: "ui-state",
							title: "Build UI state",
							prompt: "Implement the UI state slice.",
							dependsOn: ["storage"],
							complexity: 40,
							filesLikelyTouched: ["src/state.ts"],
						},
						{
							id: "ui-view",
							title: "Build UI view",
							prompt: "Implement the UI view slice.",
							dependsOn: ["ui-state"],
							complexity: 45,
							filesLikelyTouched: ["src/App.tsx", "src/styles.css"],
						},
					],
				},
			},
			undefined as never,
		)) as {
			ok: boolean;
			taskCount: number;
			taskGraphPath: string;
			revisionsPath: string;
		};

		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(4);
		const taskGraph = JSON.parse(
			await readFile(join(workspacePath, result.taskGraphPath), "utf8"),
		) as NKleinPlanTaskGraph;
		expect(taskGraph.tasks.map((task) => task.id)).toEqual(["storage", "ui-state", "ui-view", "release"]);
		expect(taskGraph.tasks.find((task) => task.id === "release")?.dependsOn).toEqual(["ui-view"]);
		expect(taskGraph.tasks.every((task) => task.acceptanceCommand === "npm test")).toBe(true);
		const revisionsMarkdown = await readFile(join(workspacePath, result.revisionsPath), "utf8");
		expect(revisionsMarkdown).toContain("recursive_split");
		expect(revisionsMarkdown).toContain("- feature -> storage, ui");
		expect(revisionsMarkdown).toContain("- ui -> ui-state, ui-view");
		expect(revisionsMarkdown).toContain("Dependency rewrites are reflected in tasks.json.");
	});

	it("replaces a saved plan task and re-links upstream and downstream dependencies", () => {
		const taskGraph: NKleinPlanTaskGraph = {
			schemaVersion: 1,
			slug: "checkout",
			title: "Checkout",
			tasks: [
				{
					id: "design",
					title: "Design flow",
					prompt: "Design the checkout flow.",
					dependsOn: [],
					complexity: 20,
					filesLikelyTouched: ["docs/checkout.md"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
					suggestedRole: null,
				},
				{
					id: "feature",
					title: "Build feature",
					prompt: "Build the checkout feature.",
					dependsOn: ["design"],
					complexity: 70,
					filesLikelyTouched: ["src/checkout.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
					suggestedRole: null,
				},
				{
					id: "release",
					title: "Release feature",
					prompt: "Release the checkout feature.",
					dependsOn: ["feature"],
					complexity: 20,
					filesLikelyTouched: ["src/release.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
					suggestedRole: null,
				},
			],
		};

		const result = replaceNKleinPlanTaskInGraph({
			taskGraph,
			taskId: "feature",
			replacements: [
				{
					id: "feature-api",
					title: "Build checkout API",
					prompt: "Build the checkout API.",
					dependsOn: [],
					complexity: 35,
					filesLikelyTouched: ["src/checkout-api.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
					suggestedRole: null,
				},
				{
					id: "feature-ui",
					title: "Build checkout UI",
					prompt: "Build the checkout UI.",
					dependsOn: ["feature-api"],
					complexity: 35,
					filesLikelyTouched: ["src/checkout-ui.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
					suggestedRole: null,
				},
			],
		});

		expect(result.replacementTaskIds).toEqual(["feature-api", "feature-ui"]);
		expect(result.entryTaskIds).toEqual(["feature-api"]);
		expect(result.terminalTaskIds).toEqual(["feature-ui"]);
		expect(result.taskGraph.tasks.map((task) => task.id)).toEqual(["design", "feature-api", "feature-ui", "release"]);
		expect(result.taskGraph.tasks.find((task) => task.id === "feature-api")?.dependsOn).toEqual(["design"]);
		expect(result.taskGraph.tasks.find((task) => task.id === "feature-ui")?.dependsOn).toEqual(["feature-api"]);
		expect(result.taskGraph.tasks.find((task) => task.id === "release")?.dependsOn).toEqual(["feature-ui"]);
	});

	it("applies replacement task graphs to saved plan artifacts with revision history", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-replace-"));
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "Checkout",
			spec: "Build checkout.",
			plan: "Implement checkout.",
			taskGraph: {
				schemaVersion: 1,
				slug: "Checkout",
				title: "Checkout",
				tasks: [
					{
						id: "feature",
						title: "Build feature",
						prompt: "Build the checkout feature.",
						dependsOn: [],
						complexity: 70,
						filesLikelyTouched: ["src/checkout.ts"],
						acceptanceCommand: "npm test",
						testFirst: false,
						acceptanceTestPrompt: null,
						suggestedRole: null,
					},
					{
						id: "release",
						title: "Release feature",
						prompt: "Release the checkout feature.",
						dependsOn: ["feature"],
						complexity: 20,
						filesLikelyTouched: ["src/release.ts"],
						acceptanceCommand: "npm test",
						testFirst: false,
						acceptanceTestPrompt: null,
						suggestedRole: null,
					},
				],
			},
		});

		const result = await applyNKleinPlanTaskReplacementArtifacts({
			workspacePath,
			slug: "Checkout",
			taskId: "feature",
			replacements: [
				{
					id: "feature-api",
					title: "Build checkout API",
					prompt: "Build the checkout API.",
					dependsOn: [],
					complexity: 35,
					filesLikelyTouched: ["src/checkout-api.ts"],
					acceptanceCommand: "npm test",
					testFirst: false,
					acceptanceTestPrompt: null,
					suggestedRole: null,
				},
			],
			description: "Split checkout feature after scope gap.",
			evidence: "Context budget exceeded.",
			createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		});

		expect(result.taskGraphPath).toContain("tasks.json");
		expect(result.revisionsPath).toContain("revisions.md");
		const artifacts = await readNKleinPlanArtifacts(workspacePath, "checkout");
		expect(artifacts.taskGraph.tasks.map((task) => task.id)).toEqual(["feature-api", "release"]);
		expect(artifacts.taskGraph.tasks.find((task) => task.id === "release")?.dependsOn).toEqual(["feature-api"]);
		expect(artifacts.revisionsMarkdown).toContain("2026-01-02T03:04:05.000Z - recursive_task_replaced");
		expect(artifacts.revisionsMarkdown).toContain("Split checkout feature after scope gap.");
		expect(artifacts.revisionsMarkdown).toContain("Context budget exceeded.");
	});

	it("rejects recursive expansions that exceed the depth limit", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-depth-"));
		const tool = getTool("decompose_project", workspacePath);

		await expect(
			tool.execute(
				{
					slug: "Habit Tracker",
					title: "Habit Tracker",
					spec: "Track habits.",
					plan: "Split too deeply.",
					defaultAcceptanceCommand: "npm test",
					tasks: [{ id: "a", title: "A", prompt: "A", complexity: 90 }],
					expansions: {
						a: [{ id: "b", title: "B", prompt: "B", complexity: 90 }],
						b: [{ id: "c", title: "C", prompt: "C", complexity: 90 }],
						c: [{ id: "d", title: "D", prompt: "D", complexity: 90 }],
						d: [{ id: "e", title: "E", prompt: "E", complexity: 90 }],
						e: [{ id: "f", title: "F", prompt: "F", complexity: 20 }],
					},
				},
				undefined as never,
			),
		).rejects.toThrow("recursive expansion depth limit");
	});

	it("validates expanded replacement task graphs", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-expand-task-"));
		const tool = getTool("expand_task", workspacePath);
		const oversized = createTaskGraph();
		const task = oversized.tasks[0];
		if (!task) {
			throw new Error("Expected task.");
		}
		oversized.tasks[0] = {
			...task,
			complexity: 95,
		};

		await expect(tool.execute({ taskGraph: oversized }, undefined as never)).rejects.toThrow("split it below");
		await expect(tool.execute({ taskGraph: createTaskGraph() }, undefined as never)).resolves.toMatchObject({
			ok: true,
			taskCount: 2,
			dependencyCount: 1,
		});
	});

	// §5.B subtask-DAG structural gate + re-decompose trigger — RECORD-ONLY. These lock the observe-only wiring:
	// the plan STILL applies (ok:true), the tool only ADDS a self-observation the operator can read.

	it("records a split self-observation naming a coarse (oversized) card without bouncing the plan", async () => {
		selfObservationMocks.recordSelfObservation.mockReset();
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-dag-split-"));
		const tool = getTool("decompose_project", workspacePath);

		// `coarse` sits at complexity 70: it PASSES the hard sizing gate (≤75) so it reaches the record-only DAG
		// check, but it exceeds the trigger's stricter advisory ceiling (60) ⇒ the re-decompose trigger returns
		// `split` and names it. `small` stays well-sized so the verdict is split (not merge/refine).
		const result = (await tool.execute(
			{
				slug: "Coarse Plan",
				title: "Coarse Plan",
				spec: "One coarse-but-legal card and one small card.",
				plan: "Build the coarse slice, then a small follow-up.",
				defaultAcceptanceCommand: "npm test",
				tasks: [
					{
						id: "coarse",
						title: "Build the coarse slice",
						prompt: "Implement the coarse-but-legal slice.",
						complexity: 70,
						filesLikelyTouched: ["src/coarse.ts"],
					},
					{
						id: "small",
						title: "Small follow-up",
						prompt: "Wire the small follow-up.",
						dependsOn: ["coarse"],
						complexity: 30,
						filesLikelyTouched: ["src/small.ts"],
					},
				],
			},
			undefined as never,
		)) as { ok: boolean };

		// The plan applies exactly as before — the observation never blocks it.
		expect(result.ok).toBe(true);
		const dagCall = selfObservationMocks.recordSelfObservation.mock.calls.find(
			(call) =>
				(call[0] as { metadata?: { operation?: string } }).metadata?.operation === "decompose_project_subtask_dag",
		);
		expect(dagCall).toBeDefined();
		const event = dagCall?.[0] as {
			signal: string;
			severity: string;
			message: string;
			metadata: { action: string; oversizedSubtaskIds: string[]; hasBlockingStructuralDefect: boolean };
		};
		expect(event.metadata.action).toBe("split");
		expect(event.metadata.oversizedSubtaskIds).toEqual(["coarse"]);
		expect(event.metadata.hasBlockingStructuralDefect).toBe(false);
		expect(event.signal).toBe("custom");
		expect(event.message).toContain("oversized: coarse");
	});

	it("records a dependency_cycle + redo self-observation for a mutually-recursive graph (silent-cycle hole closed)", async () => {
		selfObservationMocks.recordSelfObservation.mockReset();
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-dag-cycle-"));
		const tool = getTool("decompose_project", workspacePath);

		// A↔B: `validateTaskGraphReferences` has NO cycle detection, so this graph passes the live reference gate
		// silently today. The record-only subtask-DAG check now catches it: `validateSubtaskDag` reports a
		// dependency_cycle ⇒ `decideRedecomposeTrigger` returns `redo`. The plan STILL applies (observe-only).
		const result = (await tool.execute(
			{
				slug: "Cyclic Plan",
				title: "Cyclic Plan",
				spec: "Two mutually-recursive cards.",
				plan: "A depends on B, B depends on A.",
				defaultAcceptanceCommand: "npm test",
				tasks: [
					{
						id: "a",
						title: "Card A",
						prompt: "Do A.",
						dependsOn: ["b"],
						complexity: 30,
						filesLikelyTouched: ["src/a.ts"],
					},
					{
						id: "b",
						title: "Card B",
						prompt: "Do B.",
						dependsOn: ["a"],
						complexity: 30,
						filesLikelyTouched: ["src/b.ts"],
					},
				],
			},
			undefined as never,
		)) as { ok: boolean };

		expect(result.ok).toBe(true);
		const dagCall = selfObservationMocks.recordSelfObservation.mock.calls.find(
			(call) =>
				(call[0] as { metadata?: { operation?: string } }).metadata?.operation === "decompose_project_subtask_dag",
		);
		expect(dagCall).toBeDefined();
		const event = dagCall?.[0] as {
			signal: string;
			severity: string;
			message: string;
			metadata: {
				action: string;
				hasBlockingStructuralDefect: boolean;
				defectKinds: string[];
				cycles: string[][];
			};
		};
		expect(event.metadata.action).toBe("redo");
		expect(event.metadata.hasBlockingStructuralDefect).toBe(true);
		expect(event.metadata.defectKinds).toContain("dependency_cycle");
		// The reported cycle path names both cards and closes on its entry id (e.g. ["a","b","a"]).
		expect(event.metadata.cycles).toEqual([["a", "b", "a"]]);
		expect(event.signal).toBe("decomposition_rejected");
		expect(event.severity).toBe("error");
		expect(event.message).toContain("dependency_cycle");
	});

	it("records NO subtask-DAG observation for a clean, well-sized graph (accept ⇒ byte-identical happy path)", async () => {
		selfObservationMocks.recordSelfObservation.mockReset();
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-dag-clean-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Clean Plan",
				title: "Clean Plan",
				spec: "A clean, well-sized two-card graph.",
				plan: "Storage before UI.",
				tasks: createTaskGraph().tasks,
			},
			undefined as never,
		)) as { ok: boolean };

		expect(result.ok).toBe(true);
		// The re-decompose trigger returns `accept` for a clean graph, so nothing is recorded — the happy-path
		// telemetry is unchanged (this is the byte-identical-default guard for the observe-only wiring).
		const dagCalls = selfObservationMocks.recordSelfObservation.mock.calls.filter(
			(call) =>
				(call[0] as { metadata?: { operation?: string } }).metadata?.operation === "decompose_project_subtask_dag",
		);
		expect(dagCalls).toHaveLength(0);
	});
});
