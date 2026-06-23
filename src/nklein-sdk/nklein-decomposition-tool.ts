import { randomUUID } from "node:crypto";
import type { AgentTool } from "@nklein/shared";
import { z } from "zod";
import { loadRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskNKleinSettings,
} from "../core/api-contract";
import { withAutonomousNKleinTimeoutSettings } from "../core/autonomous-timeout-defaults";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "../core/task-board-mutations";
import { mutateWorkspaceState } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import {
	assessNKleinPlanTaskGraphQuality,
	type NKleinPlanTaskGraphQualityAssessment,
} from "./nklein-decomposition-graph-quality";
import { resolveNKleinGuidanceSkillCommand, resolveNKleinGuidanceSkillTopic } from "./nklein-guidance-skills";
import {
	appendNKleinPlanRevision,
	type NKleinPlanQuestion,
	type NKleinPlanTask,
	type NKleinPlanTaskGraph,
	nkleinPlanQuestionSchema,
	nkleinPlanTaskGraphSchema,
	nkleinPlanTaskSchema,
	readNKleinPlanArtifacts,
	updateNKleinPlanArtifactApplicationStatus,
	writeNKleinPlanArtifacts,
	writeNKleinPlanTaskGraph,
} from "./nklein-plan-artifacts";
import { type NKleinTaskRoutingCandidate, routeNKleinTask } from "./nklein-task-router";
import {
	estimateNKleinStartDifficulty,
	estimateNKleinStartFitBudgetTokens,
	estimateNKleinStartPromptTokens,
	formatNKleinTaskRoutingBlockMessage,
} from "./nklein-task-start-guard";
import { repairJsonStringValue } from "./nklein-tool-argument-repair";

const MAX_DECOMPOSED_TASK_COMPLEXITY = 75;
const MAX_DECOMPOSED_TASK_LIKELY_FILES = 3;
const MAX_DECOMPOSED_TASK_EXPANSION_DEPTH = 4;
const MAX_SHARED_PLAN_SPEC_PROMPT_CHARS = 2_400;
const MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS = 1_600;

export interface NKleinPlanTaskSharedContext {
	spec?: string | null;
	decisionsMarkdown?: string | null;
}

export interface ApplyNKleinPlanTaskGraphInput {
	board: RuntimeBoardData;
	taskGraph: NKleinPlanTaskGraph;
	baseRef: string;
	randomUuid: () => string;
	sourceTaskId?: string | null;
	modelRoleSettings?: Record<string, RuntimeTaskNKleinSettings>;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
	sharedContext?: NKleinPlanTaskSharedContext;
	now?: number;
}

export interface ApplyNKleinPlanTaskGraphResult {
	board: RuntimeBoardData;
	createdTasks: RuntimeBoardCard[];
	createdDependencies: RuntimeBoardDependency[];
	taskIdByPlanTaskId: Record<string, string>;
	rootTaskIds: string[];
	preview: NKleinPlanTaskGraphPreview;
}

export interface ValidateNKleinPlanTaskGraphResult {
	taskGraph: NKleinPlanTaskGraph;
	taskCount: number;
	dependencyCount: number;
	quality: NKleinPlanTaskGraphQualityAssessment;
}

export interface ReplaceNKleinPlanTaskInGraphResult {
	taskGraph: NKleinPlanTaskGraph;
	replacementTaskIds: string[];
	entryTaskIds: string[];
	terminalTaskIds: string[];
}

export interface ApplyNKleinPlanTaskReplacementArtifactsResult extends ReplaceNKleinPlanTaskInGraphResult {
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
	preview: NKleinPlanTaskGraphPreview;
}

export interface NKleinDecompositionAppliedEvent {
	workspacePath: string;
	sourceTaskId: string | null;
	planSlug: string;
	rootTaskIds: string[];
	taskIdByPlanTaskId: Record<string, string>;
}

export type NKleinDecompositionAppliedHandler = (event: NKleinDecompositionAppliedEvent) => Promise<void> | void;

export interface NKleinPlanTaskEstimate {
	planTaskId: string;
	title: string;
	modelLabel: string;
	estimatedWallTimeMs: number | null;
}

export interface NKleinPlanTaskGraphPreview {
	taskCount: number;
	totalEstimatedWallTimeMs: number | null;
	tasks: NKleinPlanTaskEstimate[];
	summary: string;
}

function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
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

function relaxJsonSchemaNode(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(relaxJsonSchemaNode);
	}
	if (node === null || typeof node !== "object") {
		return node;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		if (key === "required") {
			continue;
		}
		if (key === "additionalProperties") {
			// Drop the closed-object boolean form; relax a schema-valued additionalProperties (e.g. the
			// expansions map's task-array value schema) in place rather than dropping it.
			if (typeof value !== "boolean") {
				result[key] = relaxJsonSchemaNode(value);
			}
			continue;
		}
		result[key] = relaxJsonSchemaNode(value);
	}
	if (result.type === "object" && result.additionalProperties === undefined) {
		result.additionalProperties = true;
	}
	return result;
}

/**
 * Deep-relax a JSON Schema for the SDK tool boundary so the SDK never pre-rejects a model's call before our
 * handler runs. The SDK validates the WHOLE inputSchema tree up front and answers ANY violation — a typo'd or
 * missing key at any depth (e.g. `acceptenceCommand` on a task, or an omitted `title`) — with a multi-KB raw
 * Zod dump that small local models cannot recover from (they spiral into empty `{}` retries) and that bypasses
 * our in-handler JSON repair + compact errors. We keep the strict literals above as documentation of intent but
 * strip every `required` and open `additionalProperties` on every object node before handing the schema to the
 * SDK; the in-handler zod schemas (`decomposeProjectToolInputSchema` / `nkleinPlanTaskSchema`) are the real
 * validators (they require id/title/prompt with compact errors and strip unknown keys, so a typo'd
 * `acceptanceCommand` simply falls back to `defaultAcceptanceCommand`). The `properties` descriptions are
 * preserved, so the model still gets schema guidance.
 */
function toPermissiveAgentInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
	return relaxJsonSchemaNode(schema) as Record<string, unknown>;
}

const decomposeProjectToolInputSchema = nkleinPlanTaskGraphSchema
	.pick({
		title: true,
	})
	.extend({
		slug: nkleinPlanTaskGraphSchema.shape.slug,
		spec: nkleinPlanTaskSchema.shape.prompt.describe("Concise requirements markdown."),
		plan: nkleinPlanTaskSchema.shape.prompt.describe("Implementation plan markdown."),
		summary: nkleinPlanTaskSchema.shape.prompt
			.nullable()
			.optional()
			.describe("Plain-language plan summary markdown."),
		questions: z.array(nkleinPlanQuestionSchema).optional(),
		tasks: z.preprocess(repairJsonStringValue, z.array(nkleinPlanTaskSchema)),
		defaultAcceptanceCommand: nkleinPlanTaskSchema.shape.acceptanceCommand.optional(),
		minimumTaskCount: z.number().int().min(1).max(100).optional(),
		expansions: z.preprocess(repairJsonStringValue, z.record(z.string(), z.array(nkleinPlanTaskSchema))).optional(),
	});
type DecomposeProjectToolInput = {
	slug: string;
	spec: string;
	plan: string;
	summary: string | null;
	questions: NKleinPlanQuestion[];
	title: string;
	tasks: NKleinPlanTask[];
	taskGraph: NKleinPlanTaskGraph;
	defaultAcceptanceCommand?: string | null;
	minimumTaskCount: number | null;
	expansions: Record<string, NKleinPlanTask[]>;
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

function formatSharedPlanContext(context: NKleinPlanTaskSharedContext | undefined): string | null {
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
	task: NKleinPlanTask,
	sharedContext?: NKleinPlanTaskSharedContext,
	modelFitEvidence?: string | null,
): string {
	const sections = [task.prompt.trim()];
	sections.push(
		"Leaf scope: complete only this card's explicit objective. Treat shared spec and decisions as context, not permission to implement dependent or downstream cards early.",
	);
	sections.push(
		"Execution pace: read only the files needed for this card once, then make the smallest correct edit and run the acceptance check. To change an existing file, prefer the edit_file tool with a small search/replace block over rewriting the whole file. Do not repeatedly re-read unchanged files or write a chat-only plan instead of acting.",
	);
	const guidanceTopic = resolveNKleinGuidanceSkillTopic({
		title: task.title,
		prompt: task.prompt,
		filesLikelyTouched: task.filesLikelyTouched,
	});
	if (guidanceTopic) {
		sections.unshift(`/${resolveNKleinGuidanceSkillCommand(guidanceTopic)}\n\nGuidance topic: ${guidanceTopic}`);
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

function formatExpansionRevisionMarkdown(expansions: Record<string, NKleinPlanTask[]>): string | null {
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

function normalizeTaskAcceptanceCommand(task: NKleinPlanTask, defaultAcceptanceCommand: string | null): NKleinPlanTask {
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
	tasks: NKleinPlanTask[];
}

function expandDecomposeProjectTasks(input: {
	tasks: NKleinPlanTask[];
	expansions: Record<string, NKleinPlanTask[]>;
	defaultAcceptanceCommand: string | null;
	maxDepth?: number;
}): NKleinPlanTask[] {
	const maxDepth = input.maxDepth ?? MAX_DECOMPOSED_TASK_EXPANSION_DEPTH;
	const replacementByTaskId = new Map<string, ExpandedTaskReplacement>();
	const usedExpansionTaskIds = new Set<string>();
	const visitingTaskIds = new Set<string>();

	const expandTask = (task: NKleinPlanTask, depth: number): ExpandedTaskResult => {
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

function validateTaskSizingContract(task: NKleinPlanTask): void {
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

function validatePlanQuestions(questions: readonly NKleinPlanQuestion[]): void {
	for (const question of questions) {
		// An `open` clarifying question may proceed as long as it carries a working default — an `assumption` (a
		// sensible default to plan against) or an `answer`. It then stays *open* for later clarification (the
		// architect/reviewer auto-clarify loop, or the user; todo §5.S) instead of forcing the asking model to
		// fabricate an `assumed-default` just to get past validation (which both burns turns on weak models and
		// throws away the genuine question). Only reject an open question with no working default at all — planning
		// against a truly unresolved unknown is unsafe.
		if (question.status === "open" && !question.assumption?.trim() && !question.answer?.trim()) {
			throw new Error(
				`Clarifying question ${question.id} is open with no working default; add an \`assumption\` (a sensible default to plan against) so the plan can proceed while the question stays open for clarification — do not invent a hard answer.`,
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

function validateTaskGraphReferences(taskGraph: NKleinPlanTaskGraph): number {
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

function getReplacementBoundaryTaskIds(replacements: readonly NKleinPlanTask[]): {
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

export function replaceNKleinPlanTaskInGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	taskId: string;
	replacements: readonly NKleinPlanTask[];
	defaultAcceptanceCommand?: string | null;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
}): ReplaceNKleinPlanTaskInGraphResult {
	const taskGraph = nkleinPlanTaskGraphSchema.parse(input.taskGraph);
	const taskId = input.taskId.trim();
	if (!taskId) {
		throw new Error("Replacement target task id is required.");
	}
	if (!taskGraph.tasks.some((task) => task.id === taskId)) {
		throw new Error(`Task graph does not contain task ${taskId}.`);
	}
	const replacements = z.array(nkleinPlanTaskSchema).parse(input.replacements);
	if (replacements.length === 0) {
		throw new Error(`Replacement for task ${taskId} must include at least one task.`);
	}
	const replacementBoundary = getReplacementBoundaryTaskIds(replacements);
	const nextTaskGraph: NKleinPlanTaskGraph = {
		...taskGraph,
		tasks: expandDecomposeProjectTasks({
			tasks: taskGraph.tasks,
			expansions: {
				[taskId]: replacements,
			},
			defaultAcceptanceCommand: input.defaultAcceptanceCommand?.trim() || null,
		}),
	};
	validateNKleinPlanTaskGraph({
		taskGraph: nextTaskGraph,
		routingCandidates: input.routingCandidates,
	});
	return {
		taskGraph: nextTaskGraph,
		...replacementBoundary,
	};
}

export async function applyNKleinPlanTaskReplacementArtifacts(input: {
	workspacePath: string;
	slug: string;
	taskId: string;
	replacements: readonly NKleinPlanTask[];
	description?: string | null;
	evidence?: string | null;
	createdAt?: number;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
}): Promise<ApplyNKleinPlanTaskReplacementArtifactsResult> {
	const artifacts = await readNKleinPlanArtifacts(input.workspacePath, input.slug);
	const replacement = replaceNKleinPlanTaskInGraph({
		taskGraph: artifacts.taskGraph,
		taskId: input.taskId,
		replacements: input.replacements,
		routingCandidates: input.routingCandidates,
	});
	const taskGraphPath = await writeNKleinPlanTaskGraph({
		workspacePath: input.workspacePath,
		slug: artifacts.taskGraph.slug,
		taskGraph: replacement.taskGraph,
	});
	const revisionsPath = await appendNKleinPlanRevision({
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
	task: NKleinPlanTask,
	taskPrompt: string,
	routingCandidates: readonly NKleinTaskRoutingCandidate[] | undefined,
): NKleinTaskRoutingCandidate | null | undefined {
	if (!routingCandidates || routingCandidates.length === 0) {
		return undefined;
	}
	const promptTokens = estimateNKleinStartPromptTokens({
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
	const routingDecision = routeNKleinTask({
		difficulty: Math.max(task.complexity, estimateNKleinStartDifficulty(promptTokens)),
		fitBudgetTokens: estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow),
		promptTokens,
		outputTokens: 1_000,
		preferredModelKey,
		candidates: routingCandidates,
	});
	if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
		throw new Error(
			`Task ${task.id} failed the model feasibility guard: ${formatNKleinTaskRoutingBlockMessage(routingDecision)}`,
		);
	}
	return routingCandidates.find((candidate) => candidate.entry.key === routingDecision.modelKey) ?? null;
}

export function validateNKleinPlanTaskGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
	/**
	 * When true, graph-coherence violations (test/docs cards floating free of the work they verify/document)
	 * reject the graph. Defaults to false so applying an already-persisted graph or validating a partial
	 * replacement graph does not retroactively throw; the creation gate (`decompose_project`) opts in.
	 */
	enforceGraphQuality?: boolean;
}): ValidateNKleinPlanTaskGraphResult {
	const parsedTaskGraph = nkleinPlanTaskGraphSchema.parse(input.taskGraph);
	const taskGraph: NKleinPlanTaskGraph = {
		...parsedTaskGraph,
		tasks: parsedTaskGraph.tasks.map((task) => normalizeTaskAcceptanceCommand(task, null)),
	};
	for (const task of taskGraph.tasks) {
		validateTaskSizingContract(task);
		selectTaskRoutingCandidate(task, buildTaskPrompt(task), input.routingCandidates);
	}
	const dependencyCount = validateTaskGraphReferences(taskGraph);
	const quality = assessNKleinPlanTaskGraphQuality(taskGraph);
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

const DECOMPOSE_PROJECT_REQUIRED_FIELDS = ["slug", "title", "spec", "plan", "tasks"] as const;

const DECOMPOSE_PROJECT_RECOVERY_HINT =
	"Call decompose_project once with: slug (short string), title (string), spec (brief markdown), " +
	"plan (brief markdown), and tasks (a JSON array of objects, each with id, title, prompt). Start small — " +
	"3 to 6 top-level tasks is fine and you can expand later; keep spec and plan to a few sentences (longer " +
	"text is truncated). Do not resend an empty or partial call.";

function decomposeProjectFieldIsUsable(value: unknown): boolean {
	if (typeof value === "string") {
		return value.trim().length > 0;
	}
	return value !== undefined && value !== null;
}

/**
 * Small local models routinely emit a malformed decompose_project call — typo'd or extra keys, or
 * (after one failure) an empty `{}` — and then spiral. The SDK validates the tool's inputSchema
 * BEFORE execute() runs and answers a violation with a multi-KB raw Zod dump that such models cannot
 * recover from and that burns the context budget. The boundary schema is therefore permissive (see
 * createDecomposeProjectTool) and this is where validation actually happens: throw a SHORT, directive
 * message naming the missing fields so the model has a tractable path back.
 */
function assertUsableDecomposeProjectInput(input: unknown): void {
	const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const missing = DECOMPOSE_PROJECT_REQUIRED_FIELDS.filter((field) => {
		if (field === "tasks") {
			return !(Array.isArray(record.tasks) || typeof record.tasks === "string");
		}
		return !decomposeProjectFieldIsUsable(record[field]);
	});
	if (missing.length === 0) {
		return;
	}
	const lead =
		Object.keys(record).length === 0
			? "decompose_project was called with no arguments."
			: `decompose_project is missing required fields: ${missing.join(", ")}.`;
	throw new Error(`${lead} ${DECOMPOSE_PROJECT_RECOVERY_HINT}`);
}

function formatCompactSchemaIssues(error: z.ZodError, limit = 3): string {
	const issues = error.issues
		.slice(0, limit)
		.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
		.join("; ");
	const remaining = error.issues.length - limit;
	return remaining > 0 ? `${issues} (+${remaining} more)` : issues;
}

function normalizeDecomposeProjectToolInput(input: unknown): DecomposeProjectToolInput {
	assertUsableDecomposeProjectInput(input);
	const result = decomposeProjectToolInputSchema.safeParse(input);
	if (!result.success) {
		throw new Error(
			`decompose_project input failed validation — ${formatCompactSchemaIssues(result.error)}. ` +
				"Each task needs id, title, and prompt (strings); remove any other keys. Fix these and resubmit the whole call.",
		);
	}
	const parsed = result.data;
	const defaultAcceptanceCommand = parsed.defaultAcceptanceCommand?.trim() || null;
	if (parsed.tasks.length === 0) {
		throw new Error(
			"decompose_project requires at least one task. Add 3 to 6 task objects (id, title, prompt) to tasks and resubmit.",
		);
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
	task: NKleinPlanTask,
	modelRoleSettings: Record<string, RuntimeTaskNKleinSettings> | undefined,
	selectedRole: string | null | undefined,
): RuntimeTaskNKleinSettings | undefined {
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

function formatTaskModelFitEvidence(candidate: NKleinTaskRoutingCandidate | null | undefined): string {
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
	candidate: NKleinTaskRoutingCandidate | null | undefined,
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

export function previewNKleinPlanTaskGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
	sharedContext?: NKleinPlanTaskSharedContext;
}): NKleinPlanTaskGraphPreview {
	const taskGraph = validateNKleinPlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const tasks = taskGraph.tasks.map((task) => {
		const taskPrompt = buildTaskPrompt(task, input.sharedContext);
		const promptTokens = estimateNKleinStartPromptTokens({
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

export function applyNKleinPlanTaskGraphToBoard(input: ApplyNKleinPlanTaskGraphInput): ApplyNKleinPlanTaskGraphResult {
	let board = input.board;
	const taskGraph = validateNKleinPlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const usedBoardTaskIds = collectBoardTaskIds(board);
	const now = input.now ?? Date.now();
	const preview = previewNKleinPlanTaskGraph({
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
				agentId: "nklein",
				baseRef: input.baseRef,
				nkleinSettings: withAutonomousNKleinTimeoutSettings(
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
	taskGraph: NKleinPlanTaskGraph;
	sourceTaskId?: string | null;
	sharedContext?: NKleinPlanTaskSharedContext;
}): Promise<ApplyDecomposeProjectArtifactsResult> {
	const runtimeConfig = await loadRuntimeConfig(input.workspacePath).catch(() => null);
	const fallbackPreview = previewNKleinPlanTaskGraph({
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
			const applied = applyNKleinPlanTaskGraphToBoard({
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
	onApplied?: NKleinDecompositionAppliedHandler,
): AgentTool {
	return {
		name: "decompose_project",
		description:
			"Validate and persist !Klein decomposition artifacts for a project-scale idea. Use this instead of editing .nklein/nklein plan files or tasks.json directly.",
		// The strict JSON Schema below documents the intended shape; toPermissiveAgentInputSchema relaxes it
		// (strips `required`, opens `additionalProperties`) so the SDK never pre-rejects a small model's call
		// before our handler can return a compact, recoverable error. See toPermissiveAgentInputSchema.
		inputSchema: toPermissiveAgentInputSchema({
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
		}),
		async execute(input) {
			const { slug, spec, plan, summary, questions, taskGraph, expansions } =
				normalizeDecomposeProjectToolInput(input);
			const validation = validateNKleinPlanTaskGraph({ taskGraph, enforceGraphQuality: true });
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
			const artifacts = await writeNKleinPlanArtifacts({
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
				await updateNKleinPlanArtifactApplicationStatus({
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
			// Small local models routinely stringify the nested graph object; recover it the same way
			// decompose_project recovers stringified `tasks`/`expansions` before schema validation.
			const taskGraph = nkleinPlanTaskGraphSchema.parse(repairJsonStringValue(record.taskGraph));
			const validation = validateNKleinPlanTaskGraph({ taskGraph });
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

export function createNKleinDecompositionTools(options: {
	workspacePath: string;
	artifactWorkspacePath?: string | null;
	sourceTaskId?: string | null;
	onApplied?: NKleinDecompositionAppliedHandler;
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
