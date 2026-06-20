import { randomUUID } from "node:crypto";
import type { AgentTool } from "@clinebot/shared";
import { z } from "zod";
import { loadRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskClineSettings,
} from "../core/api-contract";
import { withAutonomousClineTimeoutSettings } from "../core/autonomous-timeout-defaults";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "../core/task-board-mutations";
import { mutateWorkspaceState } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import {
	assessClinePlanTaskGraphQuality,
	type ClinePlanTaskGraphQualityAssessment,
} from "./cline-decomposition-graph-quality";
import { resolveClineGuidanceSkillCommand, resolveClineGuidanceSkillTopic } from "./cline-guidance-skills";
import {
	appendClinePlanRevision,
	type ClinePlanQuestion,
	type ClinePlanTask,
	type ClinePlanTaskGraph,
	clinePlanQuestionSchema,
	clinePlanTaskGraphSchema,
	clinePlanTaskSchema,
	readClinePlanArtifacts,
	updateClinePlanArtifactApplicationStatus,
	writeClinePlanArtifacts,
	writeClinePlanTaskGraph,
} from "./cline-plan-artifacts";
import { type ClineTaskRoutingCandidate, routeClineTask } from "./cline-task-router";
import {
	estimateClineStartDifficulty,
	estimateClineStartFitBudgetTokens,
	estimateClineStartPromptTokens,
	formatClineTaskRoutingBlockMessage,
} from "./cline-task-start-guard";

const MAX_DECOMPOSED_TASK_COMPLEXITY = 75;
const MAX_DECOMPOSED_TASK_LIKELY_FILES = 3;
const MAX_DECOMPOSED_TASK_EXPANSION_DEPTH = 4;
const MAX_SHARED_PLAN_SPEC_PROMPT_CHARS = 2_400;
const MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS = 1_600;

export interface ClinePlanTaskSharedContext {
	spec?: string | null;
	decisionsMarkdown?: string | null;
}

export interface ApplyClinePlanTaskGraphInput {
	board: RuntimeBoardData;
	taskGraph: ClinePlanTaskGraph;
	baseRef: string;
	randomUuid: () => string;
	sourceTaskId?: string | null;
	modelRoleSettings?: Record<string, RuntimeTaskClineSettings>;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
	sharedContext?: ClinePlanTaskSharedContext;
	now?: number;
}

export interface ApplyClinePlanTaskGraphResult {
	board: RuntimeBoardData;
	createdTasks: RuntimeBoardCard[];
	createdDependencies: RuntimeBoardDependency[];
	taskIdByPlanTaskId: Record<string, string>;
	rootTaskIds: string[];
	preview: ClinePlanTaskGraphPreview;
}

export interface ValidateClinePlanTaskGraphResult {
	taskGraph: ClinePlanTaskGraph;
	taskCount: number;
	dependencyCount: number;
	quality: ClinePlanTaskGraphQualityAssessment;
}

export interface ReplaceClinePlanTaskInGraphResult {
	taskGraph: ClinePlanTaskGraph;
	replacementTaskIds: string[];
	entryTaskIds: string[];
	terminalTaskIds: string[];
}

export interface ApplyClinePlanTaskReplacementArtifactsResult extends ReplaceClinePlanTaskInGraphResult {
	taskGraphPath: string;
	revisionsPath: string;
}

export interface ApplyDecomposeProjectArtifactsResult {
	applied: boolean;
	createdTaskCount: number;
	createdDependencyCount: number;
	taskIdByPlanTaskId: Record<string, string>;
	rootTaskIds: string[];
	baseRef: string | null;
	message: string;
	preview: ClinePlanTaskGraphPreview;
}

export interface ClineDecompositionAppliedEvent {
	workspacePath: string;
	sourceTaskId: string | null;
	planSlug: string;
	rootTaskIds: string[];
	taskIdByPlanTaskId: Record<string, string>;
}

export type ClineDecompositionAppliedHandler = (event: ClineDecompositionAppliedEvent) => Promise<void> | void;

export interface ClinePlanTaskEstimate {
	planTaskId: string;
	title: string;
	modelLabel: string;
	estimatedWallTimeMs: number | null;
}

export interface ClinePlanTaskGraphPreview {
	taskCount: number;
	totalEstimatedWallTimeMs: number | null;
	tasks: ClinePlanTaskEstimate[];
	summary: string;
}

function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function parseJsonStringValue(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return value;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		const recovered = parseJsonPrefixWithTrailingClosers(trimmed);
		return recovered.success ? recovered.value : value;
	}
}

function parseJsonPrefixWithTrailingClosers(value: string): { success: true; value: unknown } | { success: false } {
	const first = value[0];
	if (first !== "[" && first !== "{") {
		return { success: false };
	}
	const stack: string[] = [];
	let inString = false;
	let escaping = false;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (inString) {
			if (escaping) {
				escaping = false;
			} else if (char === "\\") {
				escaping = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "[" || char === "{") {
			stack.push(char === "[" ? "]" : "}");
			continue;
		}
		if (char !== "]" && char !== "}") {
			continue;
		}
		const expected = stack.pop();
		if (expected !== char) {
			return { success: false };
		}
		if (stack.length === 0) {
			const trailing = value.slice(index + 1).trim();
			if (!/^[\]}]*$/.test(trailing)) {
				return { success: false };
			}
			try {
				return { success: true, value: JSON.parse(value.slice(0, index + 1)) };
			} catch {
				return { success: false };
			}
		}
	}
	return { success: false };
}

const decomposeProjectTaskJsonSchema = {
	type: "object",
	properties: {
		id: { type: "string" },
		title: { type: "string" },
		prompt: { type: "string" },
		dependsOn: { type: "array", items: { type: "string" } },
		complexity: { type: "number" },
		suggestedRole: { type: ["string", "null"] },
		filesLikelyTouched: { type: "array", items: { type: "string" } },
		acceptanceCommand: { type: ["string", "null"] },
		testFirst: { type: "boolean" },
		acceptanceTestPrompt: { type: ["string", "null"] },
		knowledgeDebt: {
			type: ["string", "null"],
			description:
				"What this card still does not know about its domain and what a later card should verify. Use for domain-heavy work (e.g. DSP/audio, crypto, hardware) where assumptions are risky.",
		},
	},
	required: ["id", "title", "prompt"],
	additionalProperties: false,
} as const;

const decomposeProjectTaskArrayJsonSchema = {
	type: "array",
	items: decomposeProjectTaskJsonSchema,
} as const;

const decomposeProjectStringifiedTaskArrayJsonSchema = {
	type: "string",
	description: "JSON-stringified array of task leaves; accepted for small models that stringify nested arrays.",
} as const;

const decomposeProjectExpansionsJsonSchema = {
	type: "object",
	additionalProperties: decomposeProjectTaskArrayJsonSchema,
} as const;

const decomposeProjectStringifiedExpansionsJsonSchema = {
	type: "string",
	description:
		"JSON-stringified recursive replacement map; accepted for small models that stringify nested expansion objects.",
} as const;

const decomposeProjectToolInputSchema = clinePlanTaskGraphSchema
	.pick({
		title: true,
	})
	.extend({
		slug: clinePlanTaskGraphSchema.shape.slug,
		spec: clinePlanTaskSchema.shape.prompt.describe("Concise requirements markdown."),
		plan: clinePlanTaskSchema.shape.prompt.describe("Implementation plan markdown."),
		summary: clinePlanTaskSchema.shape.prompt.nullable().optional().describe("Plain-language plan summary markdown."),
		questions: z.array(clinePlanQuestionSchema).optional(),
		tasks: z.preprocess(parseJsonStringValue, z.array(clinePlanTaskSchema)),
		defaultAcceptanceCommand: clinePlanTaskSchema.shape.acceptanceCommand.optional(),
		minimumTaskCount: z.number().int().min(1).max(100).optional(),
		expansions: z.preprocess(parseJsonStringValue, z.record(z.string(), z.array(clinePlanTaskSchema))).optional(),
	});
type DecomposeProjectToolInput = {
	slug: string;
	spec: string;
	plan: string;
	summary: string | null;
	questions: ClinePlanQuestion[];
	title: string;
	tasks: ClinePlanTask[];
	taskGraph: ClinePlanTaskGraph;
	defaultAcceptanceCommand?: string | null;
	minimumTaskCount: number | null;
	expansions: Record<string, ClinePlanTask[]>;
};

function slugifyTaskId(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "task";
}

function truncateSharedContext(value: string, maxChars: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function formatSharedPlanContext(context: ClinePlanTaskSharedContext | undefined): string | null {
	const sections: string[] = [];
	if (context?.spec?.trim()) {
		sections.push(`Shared spec:\n${truncateSharedContext(context.spec, MAX_SHARED_PLAN_SPEC_PROMPT_CHARS)}`);
	}
	if (context?.decisionsMarkdown?.trim()) {
		sections.push(
			`Shared decisions:\n${truncateSharedContext(
				context.decisionsMarkdown,
				MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS,
			)}`,
		);
	}
	if (sections.length === 0) {
		return null;
	}
	return sections.join("\n\n");
}

function buildTaskPrompt(
	task: ClinePlanTask,
	sharedContext?: ClinePlanTaskSharedContext,
	modelFitEvidence?: string | null,
): string {
	const sections = [task.prompt.trim()];
	sections.push(
		"Leaf scope: complete only this card's explicit objective. Treat shared spec and decisions as context, not permission to implement dependent or downstream cards early.",
	);
	sections.push(
		"Execution pace: read only the files needed for this card once, then make the smallest correct edit and run the acceptance check. Do not repeatedly re-read unchanged files or write a chat-only plan instead of acting.",
	);
	const guidanceTopic = resolveClineGuidanceSkillTopic({
		title: task.title,
		prompt: task.prompt,
		filesLikelyTouched: task.filesLikelyTouched,
	});
	if (guidanceTopic) {
		sections.unshift(`/${resolveClineGuidanceSkillCommand(guidanceTopic)}\n\nGuidance topic: ${guidanceTopic}`);
	}
	const sharedPlanContext = formatSharedPlanContext(sharedContext);
	if (sharedPlanContext) {
		sections.push(sharedPlanContext);
	}
	if (task.filesLikelyTouched.length > 0) {
		sections.push(["Likely files:", ...task.filesLikelyTouched.map((path) => `- ${path}`)].join("\n"));
	}
	if (task.acceptanceCommand) {
		sections.push(`Acceptance check: ${task.acceptanceCommand}`);
	}
	if (task.testFirst) {
		const testInstructions = ["Test-first: write or update the acceptance test before implementation."];
		if (task.acceptanceTestPrompt?.trim()) {
			testInstructions.push(task.acceptanceTestPrompt.trim());
		}
		sections.push(testInstructions.join("\n"));
	}
	sections.push(`Complexity: ${Math.round(task.complexity)}/100`);
	if (task.knowledgeDebt?.trim()) {
		sections.push(
			`Knowledge debt (what this card may not fully know yet — verify before relying on it): ${task.knowledgeDebt.trim()}`,
		);
	}
	if (task.suggestedRole) {
		sections.push(`Suggested role: ${task.suggestedRole}`);
	}
	if (modelFitEvidence?.trim()) {
		sections.push(`Model fit: ${modelFitEvidence.trim()}`);
	}
	return sections.join("\n\n");
}

function uniqStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function formatExpansionRevisionMarkdown(expansions: Record<string, ClinePlanTask[]>): string | null {
	const expansionEntries = Object.entries(expansions).filter(([, replacements]) => replacements.length > 0);
	if (expansionEntries.length === 0) {
		return null;
	}
	const lines = [
		"# Revisions",
		"",
		`## ${new Date().toISOString()} - recursive_split`,
		"",
		"Recursive task expansion was applied before plan artifacts were written.",
		"",
		"Expanded tasks:",
		...expansionEntries.map(([taskId, replacements]) => {
			const replacementIds = replacements.map((task) => task.id).join(", ");
			return `- ${taskId} -> ${replacementIds}`;
		}),
		"",
		"Dependency rewrites are reflected in tasks.json.",
	];
	return `${lines.join("\n")}\n`;
}

function normalizeTaskAcceptanceCommand(task: ClinePlanTask, defaultAcceptanceCommand: string | null): ClinePlanTask {
	const normalizedDefaultAcceptanceCommand = defaultAcceptanceCommand?.trim() || null;
	const acceptanceTestPrompt = task.acceptanceTestPrompt?.trim() || null;
	return {
		...task,
		acceptanceCommand: normalizedDefaultAcceptanceCommand ?? task.acceptanceCommand?.trim() ?? null,
		testFirst: task.testFirst && acceptanceTestPrompt !== null,
		acceptanceTestPrompt,
		knowledgeDebt: task.knowledgeDebt?.trim() || null,
		dependsOn: uniqStrings(task.dependsOn),
	};
}

interface ExpandedTaskReplacement {
	entryTaskIds: string[];
	terminalTaskIds: string[];
}

interface ExpandedTaskResult extends ExpandedTaskReplacement {
	tasks: ClinePlanTask[];
}

function expandDecomposeProjectTasks(input: {
	tasks: ClinePlanTask[];
	expansions: Record<string, ClinePlanTask[]>;
	defaultAcceptanceCommand: string | null;
	maxDepth?: number;
}): ClinePlanTask[] {
	const maxDepth = input.maxDepth ?? MAX_DECOMPOSED_TASK_EXPANSION_DEPTH;
	const replacementByTaskId = new Map<string, ExpandedTaskReplacement>();
	const usedExpansionTaskIds = new Set<string>();
	const visitingTaskIds = new Set<string>();

	const expandTask = (task: ClinePlanTask, depth: number): ExpandedTaskResult => {
		const normalizedTask = normalizeTaskAcceptanceCommand(task, input.defaultAcceptanceCommand);
		const replacementTasks = input.expansions[normalizedTask.id];
		if (!replacementTasks) {
			return {
				tasks: [normalizedTask],
				entryTaskIds: [normalizedTask.id],
				terminalTaskIds: [normalizedTask.id],
			};
		}
		if (replacementTasks.length === 0) {
			throw new Error(`Expansion for task ${normalizedTask.id} must include at least one replacement task.`);
		}
		if (depth >= maxDepth) {
			throw new Error(
				`Task ${normalizedTask.id} exceeds the recursive expansion depth limit of ${maxDepth}; escalate instead of splitting indefinitely.`,
			);
		}
		if (visitingTaskIds.has(normalizedTask.id)) {
			throw new Error(`Recursive expansion cycle detected at task ${normalizedTask.id}.`);
		}
		usedExpansionTaskIds.add(normalizedTask.id);
		visitingTaskIds.add(normalizedTask.id);
		const childResults = replacementTasks.map((replacementTask) => expandTask(replacementTask, depth + 1));
		visitingTaskIds.delete(normalizedTask.id);

		const childTasks = childResults.flatMap((result) => result.tasks);
		const childTaskIds = new Set(childTasks.map((childTask) => childTask.id));
		const dependedOnByChildTaskIds = new Set<string>();
		for (const childTask of childTasks) {
			for (const dependencyTaskId of childTask.dependsOn) {
				if (childTaskIds.has(dependencyTaskId)) {
					dependedOnByChildTaskIds.add(dependencyTaskId);
				}
			}
		}
		const entryTaskIds = childTasks
			.filter((childTask) => !childTask.dependsOn.some((dependencyTaskId) => childTaskIds.has(dependencyTaskId)))
			.map((childTask) => childTask.id);
		const terminalTaskIds = childTasks
			.filter((childTask) => !dependedOnByChildTaskIds.has(childTask.id))
			.map((childTask) => childTask.id);
		if (entryTaskIds.length === 0 || terminalTaskIds.length === 0) {
			throw new Error(`Expansion for task ${normalizedTask.id} must be an acyclic replacement graph.`);
		}
		const entryTaskIdSet = new Set(entryTaskIds);
		const tasksWithInheritedDependencies = childTasks.map((childTask) =>
			entryTaskIdSet.has(childTask.id)
				? {
						...childTask,
						dependsOn: uniqStrings([...normalizedTask.dependsOn, ...childTask.dependsOn]),
					}
				: childTask,
		);
		replacementByTaskId.set(normalizedTask.id, {
			entryTaskIds,
			terminalTaskIds,
		});
		return {
			tasks: tasksWithInheritedDependencies,
			entryTaskIds,
			terminalTaskIds,
		};
	};

	const expandedTasks = input.tasks.flatMap((task) => expandTask(task, 0).tasks);
	const unknownExpansionTaskIds = Object.keys(input.expansions).filter((taskId) => !usedExpansionTaskIds.has(taskId));
	if (unknownExpansionTaskIds.length > 0) {
		throw new Error(`Expansion references unknown task id ${unknownExpansionTaskIds[0]}.`);
	}
	return expandedTasks.map((task) => ({
		...task,
		dependsOn: uniqStrings(
			task.dependsOn.flatMap(
				(dependencyTaskId) => replacementByTaskId.get(dependencyTaskId)?.terminalTaskIds ?? [dependencyTaskId],
			),
		).filter((dependencyTaskId) => dependencyTaskId !== task.id),
	}));
}

function validateTaskSizingContract(task: ClinePlanTask): void {
	if (!task.acceptanceCommand?.trim()) {
		throw new Error(`Task ${task.id} is missing an acceptanceCommand; split or specify an objective check.`);
	}
	if (task.testFirst && !task.acceptanceTestPrompt?.trim()) {
		throw new Error(`Task ${task.id} is test-first but missing an acceptanceTestPrompt.`);
	}
	if (task.complexity > MAX_DECOMPOSED_TASK_COMPLEXITY) {
		throw new Error(
			`Task ${task.id} has complexity ${Math.round(task.complexity)}/100; split it below ${MAX_DECOMPOSED_TASK_COMPLEXITY}/100 before decomposing.`,
		);
	}
	if (task.filesLikelyTouched.length > MAX_DECOMPOSED_TASK_LIKELY_FILES) {
		throw new Error(
			`Task ${task.id} touches ${task.filesLikelyTouched.length} likely files; split it to ${MAX_DECOMPOSED_TASK_LIKELY_FILES} files or fewer before decomposing.`,
		);
	}
}

function validatePlanQuestions(questions: readonly ClinePlanQuestion[]): void {
	for (const question of questions) {
		if (question.status === "open") {
			throw new Error(
				`Clarifying question ${question.id} is still open; answer it or record an assumed-default before writing plan artifacts.`,
			);
		}
		if (question.status === "answered" && !question.answer?.trim()) {
			throw new Error(`Clarifying question ${question.id} is marked answered but missing an answer.`);
		}
		if (question.status === "assumed-default" && !question.assumption?.trim()) {
			throw new Error(`Clarifying question ${question.id} is marked assumed-default but missing an assumption.`);
		}
	}
}

function validateTaskGraphReferences(taskGraph: ClinePlanTaskGraph): number {
	const taskIds = new Set<string>();
	let dependencyCount = 0;
	for (const task of taskGraph.tasks) {
		if (taskIds.has(task.id)) {
			throw new Error(`Task graph contains duplicate task id ${task.id}.`);
		}
		taskIds.add(task.id);
	}
	for (const task of taskGraph.tasks) {
		for (const dependencyPlanTaskId of task.dependsOn) {
			dependencyCount += 1;
			if (!taskIds.has(dependencyPlanTaskId)) {
				throw new Error(`Task ${task.id} depends on unknown task ${dependencyPlanTaskId}.`);
			}
		}
	}
	return dependencyCount;
}

function getReplacementBoundaryTaskIds(replacements: readonly ClinePlanTask[]): {
	replacementTaskIds: string[];
	entryTaskIds: string[];
	terminalTaskIds: string[];
} {
	const replacementTaskIds = replacements.map((task) => task.id);
	const replacementTaskIdSet = new Set(replacementTaskIds);
	const dependedOnByReplacementTaskIds = new Set<string>();
	for (const task of replacements) {
		for (const dependencyTaskId of task.dependsOn) {
			if (replacementTaskIdSet.has(dependencyTaskId)) {
				dependedOnByReplacementTaskIds.add(dependencyTaskId);
			}
		}
	}
	const entryTaskIds = replacements
		.filter((task) => !task.dependsOn.some((dependencyTaskId) => replacementTaskIdSet.has(dependencyTaskId)))
		.map((task) => task.id);
	const terminalTaskIds = replacements
		.filter((task) => !dependedOnByReplacementTaskIds.has(task.id))
		.map((task) => task.id);
	if (entryTaskIds.length === 0 || terminalTaskIds.length === 0) {
		throw new Error("Replacement graph must be acyclic and include at least one entry and terminal task.");
	}
	return {
		replacementTaskIds,
		entryTaskIds,
		terminalTaskIds,
	};
}

export function replaceClinePlanTaskInGraph(input: {
	taskGraph: ClinePlanTaskGraph;
	taskId: string;
	replacements: readonly ClinePlanTask[];
	defaultAcceptanceCommand?: string | null;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
}): ReplaceClinePlanTaskInGraphResult {
	const taskGraph = clinePlanTaskGraphSchema.parse(input.taskGraph);
	const taskId = input.taskId.trim();
	if (!taskId) {
		throw new Error("Replacement target task id is required.");
	}
	if (!taskGraph.tasks.some((task) => task.id === taskId)) {
		throw new Error(`Task graph does not contain task ${taskId}.`);
	}
	const replacements = z.array(clinePlanTaskSchema).parse(input.replacements);
	if (replacements.length === 0) {
		throw new Error(`Replacement for task ${taskId} must include at least one task.`);
	}
	const replacementBoundary = getReplacementBoundaryTaskIds(replacements);
	const nextTaskGraph: ClinePlanTaskGraph = {
		...taskGraph,
		tasks: expandDecomposeProjectTasks({
			tasks: taskGraph.tasks,
			expansions: {
				[taskId]: replacements,
			},
			defaultAcceptanceCommand: input.defaultAcceptanceCommand?.trim() || null,
		}),
	};
	validateClinePlanTaskGraph({
		taskGraph: nextTaskGraph,
		routingCandidates: input.routingCandidates,
	});
	return {
		taskGraph: nextTaskGraph,
		...replacementBoundary,
	};
}

export async function applyClinePlanTaskReplacementArtifacts(input: {
	workspacePath: string;
	slug: string;
	taskId: string;
	replacements: readonly ClinePlanTask[];
	description?: string | null;
	evidence?: string | null;
	createdAt?: number;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
}): Promise<ApplyClinePlanTaskReplacementArtifactsResult> {
	const artifacts = await readClinePlanArtifacts(input.workspacePath, input.slug);
	const replacement = replaceClinePlanTaskInGraph({
		taskGraph: artifacts.taskGraph,
		taskId: input.taskId,
		replacements: input.replacements,
		routingCandidates: input.routingCandidates,
	});
	const taskGraphPath = await writeClinePlanTaskGraph({
		workspacePath: input.workspacePath,
		slug: artifacts.taskGraph.slug,
		taskGraph: replacement.taskGraph,
	});
	const revisionsPath = await appendClinePlanRevision({
		workspacePath: input.workspacePath,
		slug: artifacts.taskGraph.slug,
		taskId: input.taskId,
		kind: "recursive_task_replaced",
		description:
			input.description?.trim() ||
			`Replaced ${input.taskId} with ${replacement.replacementTaskIds.join(", ")} and re-linked dependencies through entry/terminal replacement tasks.`,
		evidence:
			input.evidence?.trim() ||
			`Entry replacements: ${replacement.entryTaskIds.join(", ")}. Terminal replacements: ${replacement.terminalTaskIds.join(", ")}.`,
		createdAt: input.createdAt,
	});
	return {
		...replacement,
		taskGraphPath,
		revisionsPath,
	};
}

function selectTaskRoutingCandidate(
	task: ClinePlanTask,
	taskPrompt: string,
	routingCandidates: readonly ClineTaskRoutingCandidate[] | undefined,
): ClineTaskRoutingCandidate | null | undefined {
	if (!routingCandidates || routingCandidates.length === 0) {
		return undefined;
	}
	const promptTokens = estimateClineStartPromptTokens({
		prompt: taskPrompt,
		taskTitle: task.title,
	});
	const largestContextWindow =
		routingCandidates
			.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
			.filter((contextWindow) => contextWindow > 0)
			.sort((left, right) => right - left)[0] ?? null;
	const preferredModelKey = task.suggestedRole
		? (routingCandidates.find((candidate) => candidate.role === task.suggestedRole)?.entry.key ?? null)
		: null;
	const routingDecision = routeClineTask({
		difficulty: Math.max(task.complexity, estimateClineStartDifficulty(promptTokens)),
		fitBudgetTokens: estimateClineStartFitBudgetTokens(promptTokens, largestContextWindow),
		promptTokens,
		outputTokens: 1_000,
		preferredModelKey,
		candidates: routingCandidates,
	});
	if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
		throw new Error(
			`Task ${task.id} failed the model feasibility guard: ${formatClineTaskRoutingBlockMessage(routingDecision)}`,
		);
	}
	return routingCandidates.find((candidate) => candidate.entry.key === routingDecision.modelKey) ?? null;
}

export function validateClinePlanTaskGraph(input: {
	taskGraph: ClinePlanTaskGraph;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
	/**
	 * When true, graph-coherence violations (test/docs cards floating free of the work they verify/document)
	 * reject the graph. Defaults to false so applying an already-persisted graph or validating a partial
	 * replacement graph does not retroactively throw; the creation gate (`decompose_project`) opts in.
	 */
	enforceGraphQuality?: boolean;
}): ValidateClinePlanTaskGraphResult {
	const parsedTaskGraph = clinePlanTaskGraphSchema.parse(input.taskGraph);
	const taskGraph: ClinePlanTaskGraph = {
		...parsedTaskGraph,
		tasks: parsedTaskGraph.tasks.map((task) => normalizeTaskAcceptanceCommand(task, null)),
	};
	for (const task of taskGraph.tasks) {
		validateTaskSizingContract(task);
		selectTaskRoutingCandidate(task, buildTaskPrompt(task), input.routingCandidates);
	}
	const dependencyCount = validateTaskGraphReferences(taskGraph);
	const quality = assessClinePlanTaskGraphQuality(taskGraph);
	if (input.enforceGraphQuality && quality.violations.length > 0) {
		throw new Error(
			`Task graph failed dependency-coherence validation:\n- ${quality.violations.join(
				"\n- ",
			)}\nAdd the missing dependency edges (or split/merge cards) and resubmit.`,
		);
	}
	return {
		taskGraph,
		taskCount: taskGraph.tasks.length,
		dependencyCount,
		quality,
	};
}

function normalizeDecomposeProjectToolInput(input: unknown): DecomposeProjectToolInput {
	const parsed = decomposeProjectToolInputSchema.parse(input);
	const defaultAcceptanceCommand = parsed.defaultAcceptanceCommand?.trim() || null;
	if (parsed.tasks.length === 0) {
		throw new Error("decompose_project requires at least one task.");
	}
	const questions = parsed.questions ?? [];
	validatePlanQuestions(questions);
	const expansions = parsed.expansions ?? {};
	const tasks = expandDecomposeProjectTasks({
		tasks: parsed.tasks,
		expansions,
		defaultAcceptanceCommand,
	});
	const minimumTaskCount = parsed.minimumTaskCount ?? null;
	if (minimumTaskCount !== null && tasks.length < minimumTaskCount) {
		throw new Error(
			`decompose_project requires at least ${minimumTaskCount} task leaves; received ${tasks.length}. Split the plan into more independently reviewable tasks.`,
		);
	}
	const taskGraph = {
		schemaVersion: 1 as const,
		slug: parsed.slug,
		title: parsed.title.trim() || parsed.slug,
		tasks,
	};
	return {
		slug: parsed.slug,
		spec: parsed.spec,
		plan: parsed.plan,
		summary: parsed.summary?.trim() || null,
		questions,
		title: parsed.title,
		tasks,
		taskGraph,
		defaultAcceptanceCommand,
		minimumTaskCount,
		expansions,
	};
}

function resolveTaskRoleSettings(
	task: ClinePlanTask,
	modelRoleSettings: Record<string, RuntimeTaskClineSettings> | undefined,
	selectedRole: string | null | undefined,
): RuntimeTaskClineSettings | undefined {
	const role = (selectedRole === undefined ? task.suggestedRole : selectedRole)?.trim();
	if (!role || !modelRoleSettings) {
		return undefined;
	}
	const settings = modelRoleSettings[role];
	if (!settings) {
		return undefined;
	}
	return {
		...(settings.providerId ? { providerId: settings.providerId } : {}),
		...(settings.modelId ? { modelId: settings.modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
		...(settings.contextScope ? { contextScope: settings.contextScope } : {}),
		...(settings.timeoutMode ? { timeoutMode: settings.timeoutMode } : {}),
		...(settings.requestTimeoutMs !== undefined ? { requestTimeoutMs: settings.requestTimeoutMs } : {}),
		...(settings.streamTimeoutMs !== undefined ? { streamTimeoutMs: settings.streamTimeoutMs } : {}),
		...(settings.toolTimeoutMs !== undefined ? { toolTimeoutMs: settings.toolTimeoutMs } : {}),
		...(settings.agentTimeoutMs !== undefined ? { agentTimeoutMs: settings.agentTimeoutMs } : {}),
		...(settings.conversationTimeoutMs !== undefined
			? { conversationTimeoutMs: settings.conversationTimeoutMs }
			: {}),
	};
}

function formatTaskModelFitEvidence(candidate: ClineTaskRoutingCandidate | null | undefined): string {
	if (candidate === undefined) {
		return "not validated before card creation; connected-local-model fit is checked when the card starts";
	}
	if (candidate === null) {
		return "validated by !Klein routing guard with the default local model";
	}
	const contextWindow = candidate.entry.contextWindow.effective;
	const contextWindowText =
		typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
			? `, context ${contextWindow.toLocaleString()}`
			: "";
	const capability = candidate.entry.capability.effectiveScore;
	const capabilityText =
		typeof capability === "number" && Number.isFinite(capability) ? `, capability ${Math.round(capability)}` : "";
	const roleText = candidate.role ? `, role ${candidate.role}` : "";
	return `validated by !Klein routing guard (${candidate.entry.providerId} / ${candidate.entry.modelId}${roleText}${contextWindowText}${capabilityText})`;
}

function estimateTaskWallTimeMs(
	candidate: ClineTaskRoutingCandidate | null | undefined,
	promptTokens: number,
): number | null {
	if (!candidate) {
		return null;
	}
	const speed = candidate.entry.speed;
	const prefillMs = speed.prefillTokensPerSecondEwma ? (promptTokens / speed.prefillTokensPerSecondEwma) * 1000 : null;
	const decodeMs = speed.decodeTokensPerSecondEwma ? (1_000 / speed.decodeTokensPerSecondEwma) * 1000 : null;
	if (prefillMs === null && decodeMs === null) {
		return speed.wallTimeMsEwma;
	}
	return Math.round((prefillMs ?? 0) + (decodeMs ?? 0) + (speed.ttftMsEwma ?? 0));
}

function formatEstimateDuration(ms: number | null): string {
	if (ms === null) {
		return "unknown";
	}
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) {
		return `~${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `~${hours}h ${remainingMinutes}m` : `~${hours}h`;
}

export function previewClinePlanTaskGraph(input: {
	taskGraph: ClinePlanTaskGraph;
	routingCandidates?: readonly ClineTaskRoutingCandidate[];
	sharedContext?: ClinePlanTaskSharedContext;
}): ClinePlanTaskGraphPreview {
	const taskGraph = validateClinePlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const tasks = taskGraph.tasks.map((task) => {
		const taskPrompt = buildTaskPrompt(task, input.sharedContext);
		const promptTokens = estimateClineStartPromptTokens({
			prompt: taskPrompt,
			taskTitle: task.title,
		});
		const selectedRoutingCandidate = selectTaskRoutingCandidate(task, taskPrompt, input.routingCandidates);
		const modelLabel = selectedRoutingCandidate
			? `${selectedRoutingCandidate.entry.providerId}/${selectedRoutingCandidate.entry.modelId}`
			: "model selected at start";
		return {
			planTaskId: task.id,
			title: task.title,
			modelLabel,
			estimatedWallTimeMs: estimateTaskWallTimeMs(selectedRoutingCandidate, promptTokens),
		};
	});
	const knownEstimates = tasks
		.map((task) => task.estimatedWallTimeMs)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	const totalEstimatedWallTimeMs =
		knownEstimates.length === tasks.length ? knownEstimates.reduce((total, value) => total + value, 0) : null;
	const previewLines = tasks
		.slice(0, 6)
		.map((task) => `${task.title}: ${formatEstimateDuration(task.estimatedWallTimeMs)} on ${task.modelLabel}`);
	const extraCount = Math.max(0, tasks.length - previewLines.length);
	return {
		taskCount: tasks.length,
		totalEstimatedWallTimeMs,
		tasks,
		summary: [
			`${formatEstimateDuration(totalEstimatedWallTimeMs)} across ${pluralizeCount(tasks.length, "card")}`,
			...previewLines,
			...(extraCount > 0 ? [`+${extraCount} more ${extraCount === 1 ? "card" : "cards"}`] : []),
		].join("\n"),
	};
}

function collectBoardTaskIds(board: RuntimeBoardData): Set<string> {
	return new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
}

function findGeneratedPlanTaskCard(input: {
	board: RuntimeBoardData;
	planSlug: string;
	planTaskId: string;
}): RuntimeBoardCard | null {
	for (const column of input.board.columns) {
		for (const card of column.cards) {
			if (
				card.generatedFromPlan?.planSlug === input.planSlug &&
				card.generatedFromPlan.planTaskId === input.planTaskId
			) {
				return card;
			}
		}
	}
	return null;
}

export function applyClinePlanTaskGraphToBoard(input: ApplyClinePlanTaskGraphInput): ApplyClinePlanTaskGraphResult {
	let board = input.board;
	const taskGraph = validateClinePlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const usedBoardTaskIds = collectBoardTaskIds(board);
	const now = input.now ?? Date.now();
	const preview = previewClinePlanTaskGraph({
		taskGraph,
		routingCandidates: input.routingCandidates,
		sharedContext: input.sharedContext,
	});

	for (const task of taskGraph.tasks) {
		const existingGeneratedCard = findGeneratedPlanTaskCard({
			board,
			planSlug: taskGraph.slug,
			planTaskId: task.id,
		});
		if (existingGeneratedCard) {
			usedBoardTaskIds.add(existingGeneratedCard.id);
			taskIdByPlanTaskId[task.id] = existingGeneratedCard.id;
			continue;
		}
		const taskPromptForRouting = buildTaskPrompt(task, input.sharedContext);
		const selectedRoutingCandidate = selectTaskRoutingCandidate(task, taskPromptForRouting, input.routingCandidates);
		const taskPrompt = buildTaskPrompt(
			task,
			input.sharedContext,
			formatTaskModelFitEvidence(selectedRoutingCandidate),
		);
		const selectedRole =
			selectedRoutingCandidate === undefined ? undefined : (selectedRoutingCandidate?.role ?? null);
		const baseTaskId = `${slugifyTaskId(taskGraph.slug)}-${slugifyTaskId(task.id)}`;
		let taskId = baseTaskId;
		for (let suffix = 2; usedBoardTaskIds.has(taskId); suffix += 1) {
			taskId = `${baseTaskId}-${suffix}`;
		}
		usedBoardTaskIds.add(taskId);
		const created = addTaskToColumn(
			board,
			"planning",
			{
				taskId,
				title: task.title,
				prompt: taskPrompt,
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "cline",
				baseRef: input.baseRef,
				clineSettings: withAutonomousClineTimeoutSettings(
					resolveTaskRoleSettings(task, input.modelRoleSettings, selectedRole),
				),
				filesLikelyTouched: task.filesLikelyTouched,
				generatedFromPlan: {
					artifactKind: "decomposition",
					planSlug: taskGraph.slug,
					planTaskId: task.id,
					sourceTaskId: input.sourceTaskId ?? null,
				},
			},
			input.randomUuid,
			now,
		);
		board = created.board;
		createdTasks.push(created.task);
		taskIdByPlanTaskId[task.id] = created.task.id;
	}

	for (const task of taskGraph.tasks) {
		const waitingTaskId = taskIdByPlanTaskId[task.id];
		if (!waitingTaskId) {
			continue;
		}
		for (const dependencyPlanTaskId of task.dependsOn) {
			const prerequisiteTaskId = taskIdByPlanTaskId[dependencyPlanTaskId];
			if (!prerequisiteTaskId) {
				throw new Error(`Task ${task.id} depends on unknown task ${dependencyPlanTaskId}.`);
			}
			const linked = addTaskDependency(board, waitingTaskId, prerequisiteTaskId);
			if (!linked.added || !linked.dependency) {
				if (linked.reason === "duplicate") {
					continue;
				}
				throw new Error(`Could not link ${task.id} to ${dependencyPlanTaskId}: ${linked.reason ?? "unknown"}.`);
			}
			board = linked.board;
			createdDependencies.push(linked.dependency);
		}
	}

	const sourceTaskId = input.sourceTaskId?.trim() || null;
	if (sourceTaskId && !Object.values(taskIdByPlanTaskId).includes(sourceTaskId)) {
		board = moveTaskToColumn(board, sourceTaskId, "completed", now).board;
	}
	const rootTaskIds = taskGraph.tasks
		.filter((task) => task.dependsOn.length === 0)
		.map((task) => taskIdByPlanTaskId[task.id])
		.filter((taskId): taskId is string => Boolean(taskId));

	return {
		board,
		createdTasks,
		createdDependencies,
		taskIdByPlanTaskId,
		rootTaskIds,
		preview,
	};
}

async function applyDecomposeProjectArtifactsToWorkspace(input: {
	workspacePath: string;
	taskGraph: ClinePlanTaskGraph;
	sourceTaskId?: string | null;
	sharedContext?: ClinePlanTaskSharedContext;
}): Promise<ApplyDecomposeProjectArtifactsResult> {
	const runtimeConfig = await loadRuntimeConfig(input.workspacePath).catch(() => null);
	const fallbackPreview = previewClinePlanTaskGraph({
		taskGraph: input.taskGraph,
		sharedContext: input.sharedContext,
	});
	if (runtimeConfig?.decompositionAutoApplyEnabled === false) {
		return {
			applied: false,
			createdTaskCount: 0,
			createdDependencyCount: 0,
			taskIdByPlanTaskId: {},
			rootTaskIds: [],
			baseRef: null,
			message: "Automatic card creation is disabled, so the task graph was kept pending for review.",
			preview: fallbackPreview,
		};
	}
	try {
		const result = await mutateWorkspaceState<ApplyDecomposeProjectArtifactsResult>(input.workspacePath, (state) => {
			const baseRef = state.git.currentBranch ?? state.git.defaultBranch;
			if (!baseRef) {
				return {
					board: state.board,
					save: false,
					value: {
						applied: false,
						createdTaskCount: 0,
						createdDependencyCount: 0,
						taskIdByPlanTaskId: {},
						rootTaskIds: [],
						baseRef: null,
						message: "Could not determine a base branch, so the task graph was persisted but not applied.",
						preview: fallbackPreview,
					},
				};
			}
			const applied = applyClinePlanTaskGraphToBoard({
				board: state.board,
				taskGraph: input.taskGraph,
				baseRef,
				randomUuid: randomUUID,
				sourceTaskId: input.sourceTaskId,
				modelRoleSettings: runtimeConfig?.modelRoles,
				sharedContext: input.sharedContext,
			});
			return {
				board: applied.board,
				value: {
					applied: true,
					createdTaskCount: applied.createdTasks.length,
					createdDependencyCount: applied.createdDependencies.length,
					taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
					rootTaskIds: applied.rootTaskIds,
					baseRef,
					message: `Applied task graph to !Klein: created ${pluralizeCount(applied.createdTasks.length, "Planning card")} and ${pluralizeCount(applied.createdDependencies.length, "dependency", "dependencies")}.`,
					preview: applied.preview,
				},
			};
		});
		return result.value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await recordSelfObservation({
			signal: "runtime_error",
			severity: "warning",
			message: `Plan artifact auto-apply failed: ${message}`,
			taskId: input.sourceTaskId ?? null,
			workspacePath: input.workspacePath,
			metadata: {
				operation: "decompose_project_auto_apply",
				planSlug: input.taskGraph.slug,
				taskCount: input.taskGraph.tasks.length,
			},
		});
		return {
			applied: false,
			createdTaskCount: 0,
			createdDependencyCount: 0,
			taskIdByPlanTaskId: {},
			rootTaskIds: [],
			baseRef: null,
			message: `Could not apply the task graph automatically: ${message}`,
			preview: fallbackPreview,
		};
	}
}

function createDecomposeProjectTool(
	workspacePath: string,
	sourceTaskId?: string | null,
	onApplied?: ClineDecompositionAppliedHandler,
): AgentTool {
	return {
		name: "decompose_project",
		description:
			"Validate and persist !Klein decomposition artifacts for a project-scale idea. Use this instead of editing .cline/nklein plan files or tasks.json directly.",
		inputSchema: {
			type: "object",
			properties: {
				slug: { type: "string", description: "Short stable plan slug, for example habit-insights." },
				spec: { type: "string", description: "Approved concise specification markdown, not a file path." },
				plan: { type: "string", description: "Implementation plan markdown." },
				summary: {
					type: "string",
					description:
						"Short plain-language summary for non-technical review: what will be built, the step count, and any assumptions.",
				},
				questions: {
					type: "array",
					description:
						"Clarifying questions considered before writing the plan. Open questions are rejected; record answered items or explicit assumed defaults.",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							question: { type: "string" },
							status: { type: "string", enum: ["open", "answered", "assumed-default"] },
							options: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										label: { type: "string" },
										description: { type: "string" },
										recommended: { type: "boolean" },
									},
									required: ["id", "label"],
									additionalProperties: false,
								},
							},
							answer: { type: ["string", "null"] },
							assumption: { type: ["string", "null"] },
						},
						required: ["id", "question", "status"],
						additionalProperties: false,
					},
				},
				title: { type: "string", description: "Project/task graph title." },
				tasks: {
					anyOf: [decomposeProjectTaskArrayJsonSchema, decomposeProjectStringifiedTaskArrayJsonSchema],
					description:
						"Task leaves. May be an array or a JSON-stringified array. !Klein adds schemaVersion, slug, title, validates dependencies, and writes artifacts.",
				},
				defaultAcceptanceCommand: {
					type: "string",
					description: "Optional acceptance command applied to tasks that omit acceptanceCommand.",
				},
				minimumTaskCount: {
					type: "number",
					description:
						"Optional minimum number of terminal task leaves required after recursive expansions are applied. Use this when the request specifies a minimum such as at least ten tasks.",
				},
				expansions: {
					anyOf: [decomposeProjectExpansionsJsonSchema, decomposeProjectStringifiedExpansionsJsonSchema],
					description:
						"Optional recursive replacement map. May be an object or a JSON-stringified object. Keys are oversized task ids from tasks or another expansion; values are smaller replacement tasks. !Klein expands these before validation and rewrites dependencies to terminal replacement leaves.",
				},
			},
			required: ["slug", "spec", "plan", "title", "tasks"],
			additionalProperties: false,
		},
		async execute(input) {
			const { slug, spec, plan, summary, questions, taskGraph, expansions } =
				normalizeDecomposeProjectToolInput(input);
			const validation = validateClinePlanTaskGraph({ taskGraph, enforceGraphQuality: true });
			if (validation.quality.warnings.length > 0) {
				await recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `decompose_project graph-quality warnings for plan ${slug}`,
					taskId: sourceTaskId ?? null,
					workspacePath,
					metadata: {
						operation: "decompose_project_graph_quality",
						planSlug: slug,
						taskCount: validation.quality.taskCount,
						dependencyCount: validation.quality.dependencyCount,
						dependencyDensity: validation.quality.dependencyDensity,
						warnings: validation.quality.warnings,
					},
				});
			}
			const artifacts = await writeClinePlanArtifacts({
				workspacePath,
				slug,
				spec,
				plan,
				summary,
				questions,
				revisions: formatExpansionRevisionMarkdown(expansions),
				taskGraph: validation.taskGraph,
				sourceTaskId,
			});
			const applied = await applyDecomposeProjectArtifactsToWorkspace({
				workspacePath,
				taskGraph: artifacts.taskGraph,
				sourceTaskId,
				sharedContext: {
					spec: artifacts.spec,
					decisionsMarkdown: artifacts.decisionsMarkdown,
				},
			});
			if (applied.applied) {
				await updateClinePlanArtifactApplicationStatus({
					workspacePath,
					slug: artifacts.taskGraph.slug,
					applicationStatus: "applied",
					sourceTaskId,
				});
				await onApplied?.({
					workspacePath,
					sourceTaskId: sourceTaskId ?? null,
					planSlug: artifacts.taskGraph.slug,
					rootTaskIds: applied.rootTaskIds,
					taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
				});
			}
			return {
				ok: true,
				artifactId: artifacts.artifactId,
				slug: artifacts.taskGraph.slug,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				graphQualityWarnings: validation.quality.warnings,
				applied: applied.applied,
				createdTaskCount: applied.createdTaskCount,
				createdDependencyCount: applied.createdDependencyCount,
				taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
				rootTaskIds: applied.rootTaskIds,
				preview: applied.preview,
				modelFitValidated: false,
				specPath: artifacts.specPath,
				planPath: artifacts.planPath,
				questionsPath: artifacts.questionsPath,
				decisionsPath: artifacts.decisionsPath,
				revisionsPath: artifacts.revisionsPath,
				summaryPath: artifacts.summaryPath,
				taskGraphPath: artifacts.taskGraphPath,
				instruction: applied.applied
					? `${applied.message} Dry-run preview:\n${applied.preview.summary}\nSchema and sizing validation passed; connected local model fit will be enforced when each card starts. The artifact paths in this result are trusted control-plane references for !Klein/UI recovery; sandboxed agents must not try to inspect them with read_files, list_files, find_files, read_large_file, or run_commands. Stop this planning card now and continue by starting the newly created !Klein cards; do not implement this planning card directly.`
					: `Artifacts passed schema and sizing validation, but connected local model fit was not validated in this tool call. Dry-run preview:\n${applied.preview.summary}\n${applied.message} Apply them through !Klein, not by editing task files: nklein task decompose --slug ${artifacts.taskGraph.slug} --project-path ${workspacePath}; connected-model fit is checked during apply/start.`,
			};
		},
	};
}

function createExpandTaskTool(): AgentTool {
	return {
		name: "expand_task",
		description:
			"Validate a recursively split replacement task graph for an oversized task. Prefer decompose_project.expansions for the final submission; use this only to check a replacement graph before submitting it.",
		inputSchema: {
			type: "object",
			properties: {
				taskGraph: { type: "object", description: "Replacement task graph with small executable leaves." },
			},
			required: ["taskGraph"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const taskGraph = clinePlanTaskGraphSchema.parse(record.taskGraph);
			const validation = validateClinePlanTaskGraph({ taskGraph });
			return {
				ok: true,
				taskGraph: validation.taskGraph,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				instruction:
					"Replacement graph passes the !Klein sizing contract. Connected-model fit is checked when the graph is applied. Put these replacement task leaves in decompose_project.expansions for the oversized task instead of editing plan artifacts directly.",
			};
		},
	};
}

export function createClineDecompositionTools(options: {
	workspacePath: string;
	artifactWorkspacePath?: string | null;
	sourceTaskId?: string | null;
	onApplied?: ClineDecompositionAppliedHandler;
}): AgentTool[] {
	return [
		createDecomposeProjectTool(
			options.artifactWorkspacePath?.trim() || options.workspacePath,
			options.sourceTaskId,
			options.onApplied,
		),
		createExpandTaskTool(),
	];
}
