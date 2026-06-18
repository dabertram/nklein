import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	applyClinePlanTaskGraphToBoard,
	applyClinePlanTaskReplacementArtifacts,
	createClineDecompositionTools,
	replaceClinePlanTaskInGraph,
} from "../../../src/cline-sdk/cline-decomposition-tool";
import {
	type ClinePlanTaskGraph,
	readClinePlanArtifacts,
	writeClinePlanArtifacts,
} from "../../../src/cline-sdk/cline-plan-artifacts";
import type { ClineTaskRoutingCandidate } from "../../../src/cline-sdk/cline-task-router";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { loadWorkspaceState } from "../../../src/state/workspace-state";

const execFileAsync = promisify(execFile);

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
	role: string | null;
	capability: number;
	contextWindow: number;
	prefillTokensPerSecond?: number;
	decodeTokensPerSecond?: number;
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
			},
			createdAt: 1,
			updatedAt: 1,
		},
	};
}

describe("applyClinePlanTaskGraphToBoard", () => {
	it("creates planning cards and dependency links from a task graph", () => {
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
		expect(result.createdTasks[0]?.filesLikelyTouched).toEqual(["src/storage.ts"]);
		expect(result.createdTasks[0]?.agentId).toBe("cline");
		expect(result.createdDependencies).toHaveLength(1);
		expect(result.createdDependencies[0]).toMatchObject({
			fromTaskId: "habit-tracker-ui",
			toTaskId: "habit-tracker-storage",
		});
		expect(result.board.dependencies).toEqual(result.createdDependencies);
	});

	it("includes shared plan spec and decisions in created card prompts", () => {
		const result = applyClinePlanTaskGraphToBoard({
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
		expect(result.createdTasks[0]?.prompt).toContain("Keep reminders out of the first release.");
		expect(result.createdTasks[0]?.prompt).toContain("Shared decisions:");
		expect(result.createdTasks[0]?.prompt).toContain("Assumption: Sync is out of scope.");
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

	it("keeps board task ids unique when a graph is applied more than once", () => {
		const firstApply = applyClinePlanTaskGraphToBoard({
			board: createBoard(),
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 100,
		});

		const secondApply = applyClinePlanTaskGraphToBoard({
			board: firstApply.board,
			taskGraph: createTaskGraph(),
			baseRef: "main",
			randomUuid: () => "unused",
			now: 200,
		});

		expect(secondApply.createdTasks.map((task) => task.id)).toEqual([
			"habit-tracker-storage-2",
			"habit-tracker-ui-2",
		]);
		expect(secondApply.createdDependencies[0]).toMatchObject({
			fromTaskId: "habit-tracker-ui-2",
			toTaskId: "habit-tracker-storage-2",
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

	it("writes the routed role settings when a task routes above its suggested role", () => {
		const result = applyClinePlanTaskGraphToBoard({
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

		expect(result.createdTasks[0]?.clineSettings).toEqual({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			reasoningEffort: "low",
		});
		expect(result.createdTasks[0]?.prompt).toContain(
			"Model fit: validated by Kanban routing guard (ollama / qwen3.5-9b, role worker, context 64,000, capability 35)",
		);
		expect(result.createdTasks[1]?.clineSettings).toEqual({
			providerId: "lmstudio",
			modelId: "deepseek-coder-33b",
			reasoningEffort: "high",
		});
		expect(result.createdTasks[1]?.prompt).toContain(
			"Model fit: validated by Kanban routing guard (ollama / deepseek-coder-33b, role architect, context 64,000, capability 70)",
		);
		expect(result.preview.summary).toContain("across 2 cards");
		expect(result.preview.tasks[0]).toMatchObject({
			planTaskId: "storage",
			modelLabel: "ollama/qwen3.5-9b",
			estimatedWallTimeMs: expect.any(Number),
		});
	});

	it("does not keep suggested role settings when routing selects the default model", () => {
		const result = applyClinePlanTaskGraphToBoard({
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

		expect(result.createdTasks[0]?.clineSettings).toBeUndefined();
		expect(result.createdTasks[1]?.clineSettings).toBeUndefined();
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
		expect(result.instruction).toContain("kanban task decompose --slug habit-tracker");
		expect(result.instruction).toContain("Apply them through Kanban, not by editing task files");
		expect(result.instruction).toContain("connected local model fit was not validated in this tool call");
		expect(result.instruction).toContain("connected-model fit is checked during apply/start");
		await expect(readFile(result.questionsPath, "utf8")).resolves.toContain("Reminders are out of scope");
		await expect(readFile(result.decisionsPath, "utf8")).resolves.toContain("Reminders are out of scope");
		await expect(readFile(result.revisionsPath, "utf8")).resolves.toContain("No plan revisions");
		await expect(readFile(result.summaryPath, "utf8")).resolves.toContain("two cards");
		await expect(readFile(result.taskGraphPath, "utf8")).resolves.toContain('"slug": "habit-tracker"');
	});

	it("rejects decompose_project artifacts while clarifying questions remain open", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-open-questions-"));
		const tool = getTool("decompose_project", workspacePath);

		await expect(
			tool.execute(
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
			),
		).rejects.toThrow("still open");
	});

	it("applies decompose_project artifacts to a Git-backed Kanban workspace", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-apply-"));
		const homePath = await mkdtemp(join(tmpdir(), "kanban-decompose-home-"));
		const previousHome = process.env.HOME;
		process.env.HOME = homePath;
		try {
			await execFileAsync("git", ["init"], { cwd: workspacePath });
			await execFileAsync("git", ["commit", "--allow-empty", "-m", "Initial"], {
				cwd: workspacePath,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: "Kanban Test",
					GIT_AUTHOR_EMAIL: "kanban-test@example.invalid",
					GIT_COMMITTER_NAME: "Kanban Test",
					GIT_COMMITTER_EMAIL: "kanban-test@example.invalid",
				},
			});
			const tool = getTool("decompose_project", workspacePath);

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
				applied: boolean;
				createdTaskCount: number;
				createdDependencyCount: number;
				taskIdByPlanTaskId: Record<string, string>;
				modelFitValidated: boolean;
				instruction: string;
				preview: {
					summary: string;
					taskCount: number;
				};
			};

			expect(result.ok).toBe(true);
			expect(result.applied).toBe(true);
			expect(result.createdTaskCount).toBe(2);
			expect(result.createdDependencyCount).toBe(1);
			expect(result.modelFitValidated).toBe(false);
			expect(result.taskIdByPlanTaskId).toMatchObject({
				storage: "habit-tracker-storage",
				ui: "habit-tracker-ui",
			});
			expect(result.instruction).toContain("created 2 Planning cards and 1 dependency");
			expect(result.instruction).toContain("Dry-run preview:");
			expect(result.preview.taskCount).toBe(2);
			expect(result.preview.summary).toContain("across 2 cards");
			expect(result.instruction).toContain("connected local model fit will be enforced when each card starts");
			expect(result.instruction).not.toContain("kanban task decompose");

			const state = await loadWorkspaceState(workspacePath);
			const planningCards = state.board.columns.find((column) => column.id === "planning")?.cards ?? [];
			expect(new Set(planningCards.map((card) => card.id))).toEqual(
				new Set(["habit-tracker-storage", "habit-tracker-ui"]),
			);
			expect(state.board.dependencies).toHaveLength(1);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
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
		const taskGraph = JSON.parse(await readFile(result.taskGraphPath, "utf8")) as ClinePlanTaskGraph;
		expect(taskGraph.tasks.map((task) => task.id)).toEqual(["storage", "ui-state", "ui-view", "release"]);
		expect(taskGraph.tasks.find((task) => task.id === "release")?.dependsOn).toEqual(["ui-view"]);
		expect(taskGraph.tasks.every((task) => task.acceptanceCommand === "npm test")).toBe(true);
		const revisionsMarkdown = await readFile(result.revisionsPath, "utf8");
		expect(revisionsMarkdown).toContain("recursive_split");
		expect(revisionsMarkdown).toContain("- feature -> storage, ui");
		expect(revisionsMarkdown).toContain("- ui -> ui-state, ui-view");
		expect(revisionsMarkdown).toContain("Dependency rewrites are reflected in tasks.json.");
	});

	it("replaces a saved plan task and re-links upstream and downstream dependencies", () => {
		const taskGraph: ClinePlanTaskGraph = {
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

		const result = replaceClinePlanTaskInGraph({
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
		await writeClinePlanArtifacts({
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

		const result = await applyClinePlanTaskReplacementArtifacts({
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
		const artifacts = await readClinePlanArtifacts(workspacePath, "checkout");
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
});
