import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyClinePlanTaskGraphToBoard,
	createClineDecompositionTools,
} from "../../../src/cline-sdk/cline-decomposition-tool";
import type { ClinePlanTaskGraph } from "../../../src/cline-sdk/cline-plan-artifacts";
import type { ClineTaskRoutingCandidate } from "../../../src/cline-sdk/cline-task-router";
import type { RuntimeBoardData } from "../../../src/core/api-contract";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createTaskGraph(): ClinePlanTaskGraph {
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
	role: string;
	capability: number;
	contextWindow: number;
}): ClineTaskRoutingCandidate {
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
			},
			createdAt: 1,
			updatedAt: 1,
		},
	};
}

describe("applyClinePlanTaskGraphToBoard", () => {
	it("creates backlog cards and dependency links from a task graph", () => {
		const result = applyClinePlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		expect(result.createdTasks.map((task) => task.id)).toEqual(["habit-tracker-storage", "habit-tracker-ui"]);
		expect(result.createdTasks[0]?.prompt).toContain("Likely files:");
		expect(result.createdTasks[0]?.prompt).toContain("Acceptance check: npm test");
		expect(result.createdTasks[0]?.agentId).toBe("cline");
		expect(result.createdDependencies).toHaveLength(1);
		expect(result.createdDependencies[0]).toMatchObject({
			fromTaskId: "habit-tracker-ui",
			toTaskId: "habit-tracker-storage",
		});
		expect(result.board.dependencies).toEqual(result.createdDependencies);
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

		const result = applyClinePlanTaskGraphToBoard({
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

		const result = applyClinePlanTaskGraphToBoard({
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

	it("applies Cline settings from suggested task roles", () => {
		const result = applyClinePlanTaskGraphToBoard({
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

		expect(result.createdTasks[0]?.clineSettings).toEqual({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			reasoningEffort: "medium",
		});
		expect(result.createdTasks[1]?.clineSettings).toEqual({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			reasoningEffort: "medium",
		});
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
			applyClinePlanTaskGraphToBoard({
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
			applyClinePlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: graph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("missing an acceptanceCommand");
	});

	it("rejects test-first tasks without acceptance test instructions", () => {
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

		expect(() =>
			applyClinePlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: graph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("missing an acceptanceTestPrompt");
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
			applyClinePlanTaskGraphToBoard({
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
			applyClinePlanTaskGraphToBoard({
				board: createBoard(),
				taskGraph: broadGraph,
				baseRef: "main",
				randomUuid: () => "unused",
			}),
		).toThrow("3 files or fewer");
	});

	it("accepts sized leaves that pass the model feasibility guard", () => {
		const result = applyClinePlanTaskGraphToBoard({
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
			applyClinePlanTaskGraphToBoard({
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

describe("cline decomposition tools", () => {
	function getTool(name: string, workspacePath: string) {
		const tool = createClineDecompositionTools({ workspacePath }).find((candidate) => candidate.name === name);
		if (!tool) {
			throw new Error(`Missing tool ${name}`);
		}
		return tool;
	}

	it("writes validated plan artifacts from decompose_project", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-tools-"));
		const tool = getTool("decompose_project", workspacePath);

		const result = (await tool.execute(
			{
				slug: "Habit Tracker",
				spec: "Track habits.",
				plan: "Build storage before UI.",
				taskGraph: createTaskGraph(),
			},
			undefined as never,
		)) as {
			ok: boolean;
			slug: string;
			taskCount: number;
			taskGraphPath: string;
			instruction: string;
		};

		expect(result.ok).toBe(true);
		expect(result.slug).toBe("habit-tracker");
		expect(result.taskCount).toBe(2);
		expect(result.instruction).toContain("kanban task decompose --slug habit-tracker");
		expect(result.instruction).toContain("Apply them through Kanban, not by editing task files");
		expect(result.instruction).toContain("connected-model fit is checked during apply");
		await expect(readFile(result.taskGraphPath, "utf8")).resolves.toContain('"slug": "habit-tracker"');
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
		const taskGraph = await readFile(result.taskGraphPath, "utf8");
		expect(taskGraph).toContain('"schemaVersion": 1');
		expect(taskGraph).toContain('"acceptanceCommand": "npm test"');
		expect(taskGraph).toContain('"dependsOn": [');
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
});
