import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
	addPlanGapDecisionCardToBoard,
	addPlanGapIntegrationCardToBoard,
	addPlanGapScopeCardToBoard,
	inferNKleinPlanSlugForTask,
	markTaskNeedsDecompositionOnBoard,
	recordDecompositionRejection,
	runVerifyTaskAcceptanceCommand,
} from "../../../src/commands/task";
import {
	buildPlanGapAdaptationRevision,
	buildPlanGapIntegrationRevision,
} from "../../../src/commands/task/task-plan-gap-prompts";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import {
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	type RuntimeBoardColumnId,
	type RuntimeTaskAcceptanceResult,
	type RuntimeWorkspaceStateResponse,
} from "../../../src/core/api-contract";
import { writeNKleinPlanArtifacts } from "../../../src/nklein-sdk/nklein-plan-artifacts";

const COLUMN_IDS: RuntimeBoardColumnId[] = ["backlog", "planning", "in_progress", "review", "completed", "trash"];

function createWorkspaceState(prompt: string): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/repo",
		statePath: "/state",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board: {
			columns: COLUMN_IDS.map((id) => ({
				id,
				title: id,
				cards:
					id === "in_progress"
						? [
								{
									id: "task-1",
									title: "Task 1",
									prompt,
									startInPlanMode: false,
									autoReviewEnabled: true,
									autoReviewMode: "commit",
									baseRef: "main",
									createdAt: 1,
									updatedAt: 2,
								},
							]
						: [],
			})),
			dependencies: [],
		},
		sessions: {},
		revision: 1,
	};
}

function createRuntimeConfigState(modelRoles: RuntimeConfigState["modelRoles"] = {}): RuntimeConfigState {
	return {
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		developerModeEnabled: false,
		replayCardsEnabled: false,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "local",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
		readyForReviewNotificationsEnabled: true,
		codeEmbeddingDefaults: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		codeEmbeddingOverride: null,
		effectiveCodeEmbeddingSettings: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		modelRoles,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		shortcuts: [],
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		globalConfigPath: "/repo/global.json",
		projectConfigPath: "/repo/project.json",
	};
}

// Acceptance now always runs in the task's Docker sandbox via the runtime tRPC (the host gate is retired, §5.A);
// these deps mock that verifier so the command's repair/plan-gap classification can be exercised off its result.
function sandboxVerifierDeps(acceptance: RuntimeTaskAcceptanceResult) {
	return {
		ensureRuntimeWorkspace: vi.fn(async () => "workspace-1"),
		createRuntimeTrpcClient: vi.fn(() => ({
			runtime: {
				verifyTaskAcceptance: {
					mutate: vi.fn(async () => ({
						ok: acceptance.present === true && acceptance.passed === true,
						taskId: "task-1",
						taskWorkspacePath: null,
						acceptance,
						message: "",
					})),
				},
			},
		})),
	};
}

describe("task verify command helper", () => {
	it("uses the runtime scoped sandbox verifier by default", async () => {
		const verifyTaskAcceptance = vi.fn(async () => ({
			ok: true,
			taskId: "task-1",
			taskWorkspacePath: null,
			acceptance: {
				present: true,
				command: "npm test",
				passed: true,
				exitCode: 0,
				output: "ok",
				durationMs: 10,
				failureCategory: null,
				failureHint: null,
			},
			message: "Acceptance check passed: npm test.",
		}));
		const ensureRuntimeWorkspace = vi.fn(async () => "workspace-1");
		const createRuntimeTrpcClient = vi.fn(() => ({
			runtime: {
				verifyTaskAcceptance: {
					mutate: verifyTaskAcceptance,
				},
			},
		}));

		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				ensureWorktree: true,
				timeoutMs: 1_000,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				ensureRuntimeWorkspace,
				createRuntimeTrpcClient,
				loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			},
		);

		expect(ensureRuntimeWorkspace).toHaveBeenCalledWith("/repo");
		expect(createRuntimeTrpcClient).toHaveBeenCalledWith("workspace-1");
		expect(verifyTaskAcceptance).toHaveBeenCalledWith({
			taskId: "task-1",
			ensureWorktree: true,
			timeoutMs: 1_000,
		});
		expect(result).toMatchObject({
			ok: true,
			workspacePath: "/repo",
			taskWorkspacePath: null,
			acceptance: {
				passed: true,
				command: "npm test",
			},
		});
	});

	it("returns ok false when the acceptance gate fails", async () => {
		const recordPlanGap = vi.fn();
		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				timeoutMs: 1_000,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				loadRuntimeConfig: vi.fn(async () =>
					createRuntimeConfigState({
						reviewer: {
							providerId: "anthropic",
							modelId: "claude-sonnet",
						},
					}),
				),
				...sandboxVerifierDeps({
					present: true,
					command: "npm test",
					passed: false,
					exitCode: 1,
					output: "failed",
					durationMs: 5,
					failureCategory: null,
					failureHint: null,
				}),
				recordPlanGap,
			},
		);

		expect(result).toMatchObject({
			ok: false,
			error: 'Acceptance check failed for task "task-1".',
			acceptance: {
				passed: false,
				exitCode: 1,
				output: "failed",
			},
			repair: {
				action: "repair",
				attempt: 1,
				maxAttempts: 2,
			},
		});
		expect(recordPlanGap).not.toHaveBeenCalled();
	});

	it("returns escalation guidance after repair attempts are exhausted", async () => {
		const recordPlanGap = vi.fn();
		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				repairAttempt: 3,
				maxRepairAttempts: 2,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				loadRuntimeConfig: vi.fn(async () =>
					createRuntimeConfigState({
						reviewer: {
							providerId: "anthropic",
							modelId: "claude-sonnet",
						},
					}),
				),
				...sandboxVerifierDeps({
					present: true,
					command: "npm test",
					passed: false,
					exitCode: 1,
					output: "failed",
					durationMs: 5,
					failureCategory: null,
					failureHint: null,
				}),
				recordPlanGap,
			},
		);

		expect(result).toMatchObject({
			ok: false,
			repair: {
				action: "escalate",
				attempt: 3,
				maxAttempts: 2,
				escalatedRole: "reviewer",
				escalatedSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet",
				},
			},
		});
		expect(recordPlanGap).toHaveBeenCalledWith({
			workspacePath: "/repo",
			taskId: "task-1",
			kind: "other",
			description:
				"Acceptance repair attempts are exhausted; the task needs plan-level review before more implementation work.",
			evidence: "Command: npm test\nOutput: failed",
		});
	});

	it("classifies exhausted acceptance failures that indicate missing dependencies", async () => {
		const recordPlanGap = vi.fn();
		await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				repairAttempt: 3,
				maxRepairAttempts: 2,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				loadRuntimeConfig: vi.fn(async () =>
					createRuntimeConfigState({
						reviewer: {
							providerId: "anthropic",
							modelId: "claude-sonnet",
						},
					}),
				),
				...sandboxVerifierDeps({
					present: true,
					command: "npm test",
					passed: false,
					exitCode: 1,
					output: "Error: Cannot find module './auth/types'",
					durationMs: 5,
					failureCategory: null,
					failureHint: null,
				}),
				recordPlanGap,
			},
		);

		expect(recordPlanGap).toHaveBeenCalledWith({
			workspacePath: "/repo",
			taskId: "task-1",
			kind: "missing_dependency",
			description:
				"Acceptance failed after repair attempts with output that points to a missing dependency, config, schema, or file the plan did not provide.",
			evidence: "Command: npm test\nOutput: Error: Cannot find module './auth/types'",
		});
	});

	it.each([
		{
			name: "missing environment config",
			output: "DATABASE_URL environment variable DATABASE_URL is not set",
			kind: "missing_dependency",
			description:
				"Acceptance failed after repair attempts with output that points to a missing dependency, config, schema, or file the plan did not provide.",
		},
		{
			name: "missing database schema",
			output: 'Prisma error: relation "accounts" does not exist. Missing migration?',
			kind: "missing_dependency",
			description:
				"Acceptance failed after repair attempts with output that points to a missing dependency, config, schema, or file the plan did not provide.",
		},
		{
			name: "unresolved product decision",
			output: "Acceptance blocked: ambiguous behavior, confirm which provider should be the default.",
			kind: "missing_decision",
			description:
				"Acceptance failed after repair attempts with output that points to an unresolved decision or ambiguity in the plan.",
		},
		{
			name: "conflicting requirements",
			output: "The dark mode requirement conflicts with the fixed light theme requirement.",
			kind: "contradictory_requirement",
			description:
				"Acceptance failed after repair attempts with output that points to contradictory or incompatible plan requirements.",
		},
		{
			name: "resource exhaustion",
			output: "Context length exceeded after reading too many files; decompose this task before continuing.",
			kind: "scope_too_large",
			description:
				"Acceptance failed after repair attempts with output that suggests the task scope is too large for a single card.",
		},
	] as const)("classifies acceptance plan gaps for $name", async ({ output, kind, description }) => {
		const recordPlanGap = vi.fn();
		await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				repairAttempt: 3,
				maxRepairAttempts: 2,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				...sandboxVerifierDeps({
					present: true,
					command: "npm test",
					passed: false,
					exitCode: 1,
					output,
					durationMs: 5,
					failureCategory: null,
					failureHint: null,
				}),
				recordPlanGap,
			},
		);

		expect(recordPlanGap).toHaveBeenCalledWith({
			workspacePath: "/repo",
			taskId: "task-1",
			kind,
			description,
			evidence: `Command: npm test\nOutput: ${output}`,
		});
	});

	it("returns ok false when the task has no acceptance check", async () => {
		const recordPlanGap = vi.fn();
		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Implement the task.")),
				loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				...sandboxVerifierDeps({
					present: false,
					command: null,
					passed: null,
					exitCode: null,
					output: "",
					durationMs: 0,
					failureCategory: null,
					failureHint: null,
				}),
				recordPlanGap,
			},
		);

		expect(result).toMatchObject({
			ok: false,
			error: 'Task "task-1" has no Acceptance check line.',
			taskWorkspacePath: null,
			acceptance: {
				present: false,
			},
		});
		expect(recordPlanGap).toHaveBeenCalledWith({
			workspacePath: "/repo",
			taskId: "task-1",
			kind: "other",
			description:
				"Task is missing the required Acceptance check line, so the plan lacks a machine-checkable completion contract.",
			evidence: "Implement the task.",
		});
	});
});

describe("task decompose command telemetry", () => {
	it("records rejected plan task graphs for self-observation", () => {
		const recordObservation = vi.fn();

		recordDecompositionRejection({
			workspacePath: "/repo",
			slug: "checkout-rework",
			title: "Checkout rework",
			specPath: "/repo/.nklein/nklein/plans/checkout-rework/spec.md",
			planPath: "/repo/.nklein/nklein/plans/checkout-rework/plan.md",
			questionsPath: "/repo/.nklein/nklein/plans/checkout-rework/questions.md",
			decisionsPath: "/repo/.nklein/nklein/plans/checkout-rework/decisions.md",
			revisionsPath: "/repo/.nklein/nklein/plans/checkout-rework/revisions.md",
			summaryPath: "/repo/.nklein/nklein/plans/checkout-rework/summary.md",
			taskGraphPath: "/repo/.nklein/nklein/plans/checkout-rework/tasks.json",
			error: new Error("Task api has complexity 90/100; split it below 75/100 before decomposing."),
			recordObservation,
		});

		expect(recordObservation).toHaveBeenCalledWith({
			signal: "decomposition_rejected",
			severity: "warning",
			message:
				'Task decomposition rejected for plan "checkout-rework": Task api has complexity 90/100; split it below 75/100 before decomposing.',
			workspacePath: "/repo",
			metadata: {
				slug: "checkout-rework",
				title: "Checkout rework",
				specPath: "/repo/.nklein/nklein/plans/checkout-rework/spec.md",
				planPath: "/repo/.nklein/nklein/plans/checkout-rework/plan.md",
				questionsPath: "/repo/.nklein/nklein/plans/checkout-rework/questions.md",
				decisionsPath: "/repo/.nklein/nklein/plans/checkout-rework/decisions.md",
				revisionsPath: "/repo/.nklein/nklein/plans/checkout-rework/revisions.md",
				summaryPath: "/repo/.nklein/nklein/plans/checkout-rework/summary.md",
				taskGraphPath: "/repo/.nklein/nklein/plans/checkout-rework/tasks.json",
				error: "Task api has complexity 90/100; split it below 75/100 before decomposing.",
			},
		});
	});
});

describe("task start command blocking", () => {
	it("marks tasks that need decomposition on the board", () => {
		const board = createWorkspaceState("Implement a broad task.").board;

		const nextBoard = markTaskNeedsDecompositionOnBoard(
			board,
			"task-1",
			"Task start blocked: this card needs decomposition.",
		);
		const task = nextBoard.columns.find((column) => column.id === "in_progress")?.cards[0];

		expect(task).toMatchObject({
			blockedKind: "needs_decomposition",
			blockedReason: "Task start blocked: this card needs decomposition.",
		});
	});
});

describe("task plan-gap adaptation", () => {
	it("infers the plan slug for a decomposition-created task id", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-gap-infer-"));
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "Checkout Rework",
			spec: "Rework checkout.",
			plan: "Build API before UI.",
			taskGraph: {
				schemaVersion: 1,
				slug: "Checkout Rework",
				title: "Checkout Rework",
				tasks: [
					{
						id: "api",
						title: "Build API",
						prompt: "Implement the API.",
						dependsOn: [],
						complexity: 30,
						filesLikelyTouched: ["src/api.ts"],
						acceptanceCommand: "npm test",
						testFirst: false,
						acceptanceTestPrompt: null,
						suggestedRole: null,
					},
				],
			},
		});

		await expect(
			inferNKleinPlanSlugForTask({
				workspacePath,
				taskId: "checkout-rework-api",
			}),
		).resolves.toBe("checkout-rework");
	});

	it("infers a plan slug for collision-suffixed task ids when unambiguous", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-gap-suffix-"));
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "Checkout Rework",
			spec: "Rework checkout.",
			plan: "Build API before UI.",
			taskGraph: {
				schemaVersion: 1,
				slug: "Checkout Rework",
				title: "Checkout Rework",
				tasks: [
					{
						id: "api",
						title: "Build API",
						prompt: "Implement the API.",
						dependsOn: [],
						complexity: 30,
						filesLikelyTouched: ["src/api.ts"],
						acceptanceCommand: "npm test",
						testFirst: false,
						acceptanceTestPrompt: null,
						suggestedRole: null,
					},
				],
			},
		});

		await expect(
			inferNKleinPlanSlugForTask({
				workspacePath,
				taskId: "checkout-rework-api-2",
			}),
		).resolves.toBe("checkout-rework");
	});

	it("does not infer a plan slug when multiple plans could own the task id", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-gap-ambiguous-"));
		for (const plan of [
			{ slug: "Checkout", taskId: "rework-api" },
			{ slug: "Checkout Rework", taskId: "api" },
		]) {
			await writeNKleinPlanArtifacts({
				workspacePath,
				slug: plan.slug,
				spec: "Rework checkout.",
				plan: "Build API before UI.",
				taskGraph: {
					schemaVersion: 1,
					slug: plan.slug,
					title: plan.slug,
					tasks: [
						{
							id: plan.taskId,
							title: "Build API",
							prompt: "Implement the API.",
							dependsOn: [],
							complexity: 30,
							filesLikelyTouched: ["src/api.ts"],
							acceptanceCommand: "npm test",
							testFirst: false,
							acceptanceTestPrompt: null,
							suggestedRole: null,
						},
					],
				},
			});
		}

		await expect(
			inferNKleinPlanSlugForTask({
				workspacePath,
				taskId: "checkout-rework-api",
			}),
		).resolves.toBeNull();
	});

	it("adds an integration card for integration-needed gaps", () => {
		const state = createWorkspaceState("Acceptance check: npm test");

		const result = addPlanGapIntegrationCardToBoard({
			state,
			taskId: "task-1",
			description: "The API and UI cards both changed the saved payload and need a shared migration.",
			evidence: "src/api.ts and web-ui/src/form.ts disagree about field names.",
			baseRef: "main",
			createId: () => "abcde-integration-task",
		});
		const planningCard = result.board.columns
			.find((column) => column.id === "planning")
			?.cards.find((card) => card.id === result.task.id);

		expect(result.task.id).toBe("abcde");
		expect(planningCard).toMatchObject({
			id: "abcde",
			title: "Integrate plan gap from task-1",
			startInPlanMode: true,
			autoReviewEnabled: true,
			autoReviewMode: "commit",
			agentId: "nklein",
			baseRef: "main",
		});
		expect(planningCard?.prompt).toContain('reported by task "task-1"');
		expect(planningCard?.prompt).toContain("shared migration");
		expect(planningCard?.prompt).toContain("Evidence: src/api.ts");
		expect(result.created).toBe(true);
	});

	it("deduplicates repeated integration-needed adaptations", () => {
		const first = addPlanGapIntegrationCardToBoard({
			state: createWorkspaceState("Acceptance check: npm test"),
			taskId: "task-1",
			description: "The API and UI cards both changed the saved payload and need a shared migration.",
			baseRef: "main",
			createId: () => "abcde-integration-task",
		});
		const state: RuntimeWorkspaceStateResponse = {
			...createWorkspaceState("Acceptance check: npm test"),
			board: first.board,
		};
		const second = addPlanGapIntegrationCardToBoard({
			state,
			taskId: "task-1",
			description: "The API and UI cards both changed the saved payload and need a shared migration.",
			baseRef: "main",
			createId: () => "second-integration-task",
		});
		const planningCards = second.board.columns.find((column) => column.id === "planning")?.cards ?? [];

		expect(second.created).toBe(false);
		expect(second.task.id).toBe(first.task.id);
		expect(planningCards.filter((card) => card.title === "Integrate plan gap from task-1")).toHaveLength(1);
	});

	it("adds a decision pause card for ambiguity and deduplicates repeats", () => {
		const first = addPlanGapDecisionCardToBoard({
			state: createWorkspaceState("Acceptance check: npm test"),
			taskId: "task-1",
			kind: "missing_decision",
			description: "Choose the default provider before implementation continues.",
			evidence: "The acceptance output asked which provider should be default.",
			baseRef: "main",
			createId: () => "decision-task",
		});
		const state: RuntimeWorkspaceStateResponse = {
			...createWorkspaceState("Acceptance check: npm test"),
			board: first.board,
		};
		const second = addPlanGapDecisionCardToBoard({
			state,
			taskId: "task-1",
			kind: "missing_decision",
			description: "Choose the default provider before implementation continues.",
			baseRef: "main",
			createId: () => "duplicate-decision-task",
		});
		const planningCard = first.board.columns.find((column) => column.id === "planning")?.cards[0];

		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.task.id).toBe(first.task.id);
		expect(planningCard).toMatchObject({
			id: "decis",
			title: "Resolve plan decision gap from task-1",
			startInPlanMode: true,
			autoReviewEnabled: false,
			agentId: "nklein",
			baseRef: "main",
		});
		expect(planningCard?.prompt).toContain("Ask the user for the smallest decision");
	});

	it("adds a scope adaptation card and blocks the oversized source card", () => {
		const result = addPlanGapScopeCardToBoard({
			state: createWorkspaceState("Acceptance check: npm test"),
			taskId: "task-1",
			description: "The card exceeded the context budget and needs smaller replacement leaves.",
			evidence: "Context length exceeded.",
			baseRef: "main",
			createId: () => "split-task",
		});
		const sourceCard = result.board.columns
			.find((column) => column.id === "in_progress")
			?.cards.find((card) => card.id === "task-1");
		const planningCard = result.board.columns.find((column) => column.id === "planning")?.cards[0];

		expect(result.created).toBe(true);
		expect(sourceCard).toMatchObject({
			blockedKind: "needs_decomposition",
			blockedReason: "The card exceeded the context budget and needs smaller replacement leaves.",
		});
		expect(planningCard).toMatchObject({
			id: "split",
			title: "Split oversized plan gap from task-1",
			startInPlanMode: true,
			autoReviewEnabled: false,
			agentId: "nklein",
			baseRef: "main",
		});
		expect(planningCard?.prompt).toContain("recursive expansions");
	});

	it("formats the automatic integration-card revision entry", () => {
		const revision = buildPlanGapIntegrationRevision({
			taskId: "task-1",
			integrationTaskId: "abcde",
			description: "The API and UI cards need shared payload migration glue.",
			evidence: "src/api.ts and web-ui/src/form.ts disagree.",
		});

		expect(revision).toEqual({
			kind: "integration_card_added",
			description:
				'Added Planning integration card "abcde" for plan gap reported by task "task-1": The API and UI cards need shared payload migration glue.',
			evidence: "src/api.ts and web-ui/src/form.ts disagree.",
		});
	});

	it("formats adaptive decision and scope revision entries", () => {
		expect(
			buildPlanGapAdaptationRevision({
				taskId: "task-1",
				adaptationTaskId: "decision",
				kind: "missing_decision",
				description: "Choose the default provider.",
				evidence: "Acceptance output asked which provider to use.",
			}),
		).toEqual({
			kind: "decision_card_added",
			description:
				'Added Planning decision card "decision" for plan gap reported by task "task-1": Choose the default provider.',
			evidence: "Acceptance output asked which provider to use.",
		});
		expect(
			buildPlanGapAdaptationRevision({
				taskId: "task-1",
				adaptationTaskId: "split",
				kind: "scope_too_large",
				description: "Split the oversized card.",
			}),
		).toEqual({
			kind: "scope_split_card_added",
			description:
				'Added Planning split card "split" for plan gap reported by task "task-1": Split the oversized card.',
			evidence: null,
		});
	});
});
