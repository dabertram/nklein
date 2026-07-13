import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { toSlug } from "../core/slugify";
import { lockedFileSystem } from "../fs/locked-file-system";
import { loadWorkspaceContext } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import {
	formatInitialDecisionsMarkdown,
	formatInitialRevisionsMarkdown,
	formatQuestionsMarkdown,
	formatRevisionEntry,
	parseQuestionsMarkdown,
} from "./plan-artifact-markdown";

const PLAN_ARTIFACT_KIND = "decomposition";
const PLAN_ARTIFACT_METADATA_FILENAME = "artifact.json";

export const nkleinPlanTaskSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	prompt: z.string().min(1),
	dependsOn: z.array(z.string()).default([]),
	complexity: z.number().min(0).max(100).default(50),
	suggestedRole: z.string().nullable().default(null),
	filesLikelyTouched: z.array(z.string()).default([]),
	acceptanceCommand: z.string().nullable().default(null),
	testFirst: z.boolean().default(false),
	acceptanceTestPrompt: z.string().nullable().default(null),
	knowledgeDebt: z.string().nullable().optional(),
	// §5.AK/§5.B richer per-card CONTRACT — all OPTIONAL enrichment (absent ⇒ not provided, fully backward-compatible;
	// a card decomposed without them is unchanged). A decomposition can populate them so a worker executes against an
	// explicit contract instead of re-deriving it, and downstream nodes know what a card produces + what invalidates
	// them. Consumed node-locally via `renderCardContractBrief`, which normalizes absence to an empty brief.
	preconditions: z.array(z.string()).optional(),
	inputs: z.array(z.string()).optional(),
	expectedOutputs: z.array(z.string()).optional(),
	acceptanceChecks: z.array(z.string()).optional(),
	nonGoals: z.array(z.string()).optional(),
	dependencyOutputsConsumed: z.array(z.string()).optional(),
	rollbackOrRepairHints: z.array(z.string()).optional(),
	downstreamInvalidationRules: z.array(z.string()).optional(),
	// F1.8 work-package BOUNDS (all optional) — populated by construction at decompose time (writeScope derived
	// from filesLikelyTouched when the architect does not bound it explicitly). Enforcement at dispatch/review is F1.9.
	writeScope: z.array(z.string()).optional(),
	forbiddenPaths: z.array(z.string()).optional(),
	interfaces: z.array(z.string()).optional(),
});
export type NKleinPlanTask = z.infer<typeof nkleinPlanTaskSchema>;

/** F1.8: one hot file — a path ≥2 cards write, with the parallel-write safety class of the overlap. */
export const nkleinPlanHotFileSchema = z.object({
	path: z.string().min(1),
	taskIds: z.array(z.string()),
	classification: z.enum(["yellow", "red"]),
});
export type NKleinPlanHotFile = z.infer<typeof nkleinPlanHotFileSchema>;

export const nkleinPlanTaskGraphSchema = z.object({
	schemaVersion: z.literal(1),
	slug: z.string().min(1),
	title: z.string().min(1),
	tasks: z.array(nkleinPlanTaskSchema),
	/** F1.8: the graph's hot-file classification (absent on legacy graphs; recomputed at decompose time). */
	hotFiles: z.array(nkleinPlanHotFileSchema).optional(),
});
export type NKleinPlanTaskGraph = z.infer<typeof nkleinPlanTaskGraphSchema>;

export const nkleinPlanArtifactMetadataSchema = z.object({
	artifactId: z.string().min(1),
	workspaceId: z.string().min(1).nullable(),
	workspacePath: z.string().min(1),
	sourceTaskId: z.string().min(1).nullable(),
	artifactKind: z.literal(PLAN_ARTIFACT_KIND),
	planSlug: z.string().min(1),
	createdAt: z.number(),
	updatedAt: z.number(),
	validationStatus: z.enum(["valid", "invalid", "pending"]),
	applicationStatus: z.enum(["pending", "applied", "rejected"]),
});
export type NKleinPlanArtifactMetadata = z.infer<typeof nkleinPlanArtifactMetadataSchema>;

export const nkleinPlanQuestionOptionSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	description: z.string().nullable().default(null),
	recommended: z.boolean().default(false),
});
export type NKleinPlanQuestionOption = z.infer<typeof nkleinPlanQuestionOptionSchema>;

export const nkleinPlanQuestionSchema = z.object({
	id: z.string().min(1),
	question: z.string().min(1),
	status: z.enum(["open", "answered", "assumed-default"]),
	options: z.array(nkleinPlanQuestionOptionSchema).default([]),
	answer: z.string().nullable().default(null),
	assumption: z.string().nullable().default(null),
	/** F1.3d — the card parked awaiting this question's answer; resolution resumes exactly this task. */
	blockedTaskId: z.string().nullable().default(null),
});
export type NKleinPlanQuestion = z.infer<typeof nkleinPlanQuestionSchema>;

export interface NKleinPlanArtifacts {
	metadata: NKleinPlanArtifactMetadata;
	artifactId: string;
	rootPath: string;
	metadataPath: string;
	specPath: string;
	planPath: string;
	questionsPath: string;
	decisionsPath: string;
	revisionsPath: string;
	summaryPath: string;
	taskGraphPath: string;
	spec: string;
	plan: string;
	questions: NKleinPlanQuestion[];
	questionsMarkdown: string;
	decisionsMarkdown: string;
	revisionsMarkdown: string;
	summary: string;
	taskGraph: NKleinPlanTaskGraph;
}

export interface NKleinPlanArtifactSummary {
	artifactId: string;
	artifactKind: NKleinPlanArtifactMetadata["artifactKind"];
	planSlug: string;
	title: string;
	sourceTaskId: string | null;
	createdAt: number;
	updatedAt: number;
	validationStatus: NKleinPlanArtifactMetadata["validationStatus"];
	applicationStatus: NKleinPlanArtifactMetadata["applicationStatus"];
	taskCount: number;
	dependencyCount: number;
	specPath: string;
	planPath: string;
	summaryPath: string;
	taskGraphPath: string;
}

export interface WriteNKleinPlanArtifactsInput {
	workspacePath: string;
	workspaceId?: string | null;
	sourceTaskId?: string | null;
	slug: string;
	spec: string;
	plan: string;
	questions?: NKleinPlanQuestion[];
	decisions?: string | null;
	revisions?: string | null;
	summary?: string | null;
	taskGraph: NKleinPlanTaskGraph;
}

export interface AppendNKleinPlanRevisionInput {
	workspacePath: string;
	slug: string;
	taskId?: string | null;
	kind: string;
	description: string;
	evidence?: string | null;
	createdAt?: number;
}

export interface WriteNKleinPlanTaskGraphInput {
	workspacePath: string;
	slug: string;
	taskGraph: NKleinPlanTaskGraph;
}

export interface UpdateNKleinPlanArtifactApplicationStatusInput {
	workspacePath: string;
	slug: string;
	applicationStatus: NKleinPlanArtifactMetadata["applicationStatus"];
	sourceTaskId?: string | null;
	updatedAt?: number;
}

function createPlanArtifactId(slug: string): string {
	return `${PLAN_ARTIFACT_KIND}:${slug}`;
}

async function resolveWorkspaceId(workspacePath: string, explicitWorkspaceId?: string | null): Promise<string | null> {
	if (explicitWorkspaceId !== undefined) {
		return explicitWorkspaceId;
	}
	const context = await loadWorkspaceContext(workspacePath, { autoCreateIfMissing: false }).catch(() => null);
	return context?.workspaceId ?? null;
}

function slugify(input: string): string {
	const slug = toSlug(input);
	if (!slug) {
		throw new Error("Plan slug cannot be empty.");
	}
	return slug;
}

export function resolveNKleinPlanArtifactPaths(
	workspacePath: string,
	rawSlug: string,
): {
	rootPath: string;
	specPath: string;
	planPath: string;
	questionsPath: string;
	decisionsPath: string;
	revisionsPath: string;
	summaryPath: string;
	taskGraphPath: string;
	metadataPath: string;
	slug: string;
} {
	const slug = slugify(rawSlug);
	const rootPath = join(workspacePath, ".nklein", "nklein", "plans", slug);
	return {
		rootPath,
		specPath: join(rootPath, "spec.md"),
		planPath: join(rootPath, "plan.md"),
		questionsPath: join(rootPath, "questions.md"),
		decisionsPath: join(rootPath, "decisions.md"),
		revisionsPath: join(rootPath, "revisions.md"),
		summaryPath: join(rootPath, "summary.md"),
		taskGraphPath: join(rootPath, "tasks.json"),
		metadataPath: join(rootPath, PLAN_ARTIFACT_METADATA_FILENAME),
		slug,
	};
}

export function summarizeNKleinPlanArtifacts(artifacts: NKleinPlanArtifacts): NKleinPlanArtifactSummary {
	return {
		artifactId: artifacts.artifactId,
		artifactKind: artifacts.metadata.artifactKind,
		planSlug: artifacts.taskGraph.slug,
		title: artifacts.taskGraph.title,
		sourceTaskId: artifacts.metadata.sourceTaskId,
		createdAt: artifacts.metadata.createdAt,
		updatedAt: artifacts.metadata.updatedAt,
		validationStatus: artifacts.metadata.validationStatus,
		applicationStatus: artifacts.metadata.applicationStatus,
		taskCount: artifacts.taskGraph.tasks.length,
		dependencyCount: artifacts.taskGraph.tasks.reduce((total, task) => total + task.dependsOn.length, 0),
		specPath: artifacts.specPath,
		planPath: artifacts.planPath,
		summaryPath: artifacts.summaryPath,
		taskGraphPath: artifacts.taskGraphPath,
	};
}

async function listPlanArtifactSlugs(workspacePath: string): Promise<string[]> {
	const plansPath = join(workspacePath, ".nklein", "nklein", "plans");
	const entries = await readdir(plansPath, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export async function listNKleinPlanArtifactsForSourceTask(input: {
	workspacePath: string;
	sourceTaskId: string;
	applicationStatus?: NKleinPlanArtifactMetadata["applicationStatus"];
}): Promise<NKleinPlanArtifactSummary[]> {
	const sourceTaskId = input.sourceTaskId.trim();
	if (!sourceTaskId) {
		return [];
	}
	const summaries: NKleinPlanArtifactSummary[] = [];
	for (const slug of await listPlanArtifactSlugs(input.workspacePath)) {
		const artifacts = await readNKleinPlanArtifacts(input.workspacePath, slug).catch(() => null);
		if (!artifacts || artifacts.metadata.sourceTaskId !== sourceTaskId) {
			continue;
		}
		if (input.applicationStatus && artifacts.metadata.applicationStatus !== input.applicationStatus) {
			continue;
		}
		summaries.push(summarizeNKleinPlanArtifacts(artifacts));
	}
	return summaries.sort(
		(left, right) => right.createdAt - left.createdAt || left.planSlug.localeCompare(right.planSlug),
	);
}

export async function readNKleinPlanArtifactsByArtifactId(input: {
	workspacePath: string;
	artifactId: string;
}): Promise<NKleinPlanArtifacts> {
	const artifactId = input.artifactId.trim();
	for (const slug of await listPlanArtifactSlugs(input.workspacePath)) {
		const artifacts = await readNKleinPlanArtifacts(input.workspacePath, slug).catch(() => null);
		if (artifacts?.artifactId === artifactId) {
			return artifacts;
		}
	}
	throw new Error(`Plan artifact ${artifactId || "(empty)"} was not found.`);
}

export async function writeNKleinPlanArtifacts(input: WriteNKleinPlanArtifactsInput): Promise<NKleinPlanArtifacts> {
	const paths = resolveNKleinPlanArtifactPaths(input.workspacePath, input.slug);
	const now = Date.now();
	const workspaceId = await resolveWorkspaceId(input.workspacePath, input.workspaceId);
	const taskGraph = nkleinPlanTaskGraphSchema.parse({
		...input.taskGraph,
		slug: paths.slug,
	});
	const metadata: NKleinPlanArtifactMetadata = {
		artifactId: createPlanArtifactId(paths.slug),
		workspaceId,
		workspacePath: input.workspacePath,
		sourceTaskId: input.sourceTaskId?.trim() || null,
		artifactKind: PLAN_ARTIFACT_KIND,
		planSlug: paths.slug,
		createdAt: now,
		updatedAt: now,
		validationStatus: "valid",
		applicationStatus: "pending",
	};
	const questions = z.array(nkleinPlanQuestionSchema).parse(input.questions ?? []);
	const summary = input.summary?.trim() || `# ${taskGraph.title}\n\nNo plain-language summary was provided.\n`;
	const questionsMarkdown = formatQuestionsMarkdown(questions);
	const decisionsMarkdown = input.decisions?.trim()
		? `${input.decisions.trimEnd()}\n`
		: formatInitialDecisionsMarkdown(questions);
	const revisionsMarkdown = input.revisions?.trim()
		? `${input.revisions.trimEnd()}\n`
		: formatInitialRevisionsMarkdown();
	await mkdir(paths.rootPath, { recursive: true });
	await lockedFileSystem.writeTextFileAtomic(paths.specPath, `${input.spec.trimEnd()}\n`, { lock: null });
	await lockedFileSystem.writeTextFileAtomic(paths.planPath, `${input.plan.trimEnd()}\n`, { lock: null });
	await lockedFileSystem.writeTextFileAtomic(paths.questionsPath, questionsMarkdown, { lock: null });
	await lockedFileSystem.writeTextFileAtomic(paths.decisionsPath, decisionsMarkdown, { lock: null });
	await lockedFileSystem.writeTextFileAtomic(paths.revisionsPath, revisionsMarkdown, { lock: null });
	await lockedFileSystem.writeTextFileAtomic(paths.summaryPath, `${summary.trimEnd()}\n`, { lock: null });
	await lockedFileSystem.writeJsonFileAtomic(paths.taskGraphPath, taskGraph, { lock: null });
	await lockedFileSystem.writeJsonFileAtomic(paths.metadataPath, metadata, { lock: null });
	recordSelfObservation({
		signal: "custom",
		severity: "info",
		message: `Plan artifact created: ${metadata.artifactId}`,
		taskId: metadata.sourceTaskId,
		workspacePath: input.workspacePath,
		metadata: {
			operation: "plan_artifact_lifecycle",
			stage: "created",
			artifactId: metadata.artifactId,
			planSlug: metadata.planSlug,
			applicationStatus: metadata.applicationStatus,
			validationStatus: metadata.validationStatus,
			taskCount: taskGraph.tasks.length,
			dependencyCount: taskGraph.tasks.reduce((total, task) => total + task.dependsOn.length, 0),
		},
	});
	return {
		metadata,
		artifactId: metadata.artifactId,
		rootPath: paths.rootPath,
		metadataPath: paths.metadataPath,
		specPath: paths.specPath,
		planPath: paths.planPath,
		questionsPath: paths.questionsPath,
		decisionsPath: paths.decisionsPath,
		revisionsPath: paths.revisionsPath,
		summaryPath: paths.summaryPath,
		taskGraphPath: paths.taskGraphPath,
		spec: input.spec,
		plan: input.plan,
		questions,
		questionsMarkdown,
		decisionsMarkdown,
		revisionsMarkdown,
		summary,
		taskGraph,
	};
}

export async function appendNKleinPlanRevision(input: AppendNKleinPlanRevisionInput): Promise<string> {
	const paths = resolveNKleinPlanArtifactPaths(input.workspacePath, input.slug);
	await mkdir(paths.rootPath, { recursive: true });
	const existing = await readFile(paths.revisionsPath, "utf8").catch(() => formatInitialRevisionsMarkdown());
	const trimmedExisting = existing.includes("No plan revisions have been recorded yet.")
		? "# Revisions\n"
		: existing.trimEnd();
	const nextMarkdown = `${trimmedExisting}\n\n${formatRevisionEntry(input)}`;
	await lockedFileSystem.writeTextFileAtomic(paths.revisionsPath, nextMarkdown, { lock: null });
	return paths.revisionsPath;
}

/**
 * F1.3a — rewrite ONE plan question in place (status/answer/assumption/options), preserving every other question.
 * Upserts when the id is new. Atomic write of `questions.md`; returns the updated structured list. The clarification
 * flows (auto pass + operator answers) key on this so an answer never clobbers a sibling question.
 */
export async function updateNKleinPlanQuestion(input: {
	workspacePath: string;
	slug: string;
	question: NKleinPlanQuestion;
}): Promise<NKleinPlanQuestion[]> {
	const paths = resolveNKleinPlanArtifactPaths(input.workspacePath, input.slug);
	const question = nkleinPlanQuestionSchema.parse(input.question);
	const existingMarkdown = await readFile(paths.questionsPath, "utf8").catch(() => "");
	const questions = parseQuestionsMarkdown(existingMarkdown);
	const index = questions.findIndex((candidate) => candidate.id === question.id);
	if (index >= 0) {
		questions[index] = question;
	} else {
		questions.push(question);
	}
	await mkdir(paths.rootPath, { recursive: true });
	await lockedFileSystem.writeTextFileAtomic(paths.questionsPath, formatQuestionsMarkdown(questions), { lock: null });
	return questions;
}

export async function writeNKleinPlanTaskGraph(input: WriteNKleinPlanTaskGraphInput): Promise<string> {
	const paths = resolveNKleinPlanArtifactPaths(input.workspacePath, input.slug);
	const taskGraph = nkleinPlanTaskGraphSchema.parse({
		...input.taskGraph,
		slug: paths.slug,
	});
	await mkdir(paths.rootPath, { recursive: true });
	await lockedFileSystem.writeJsonFileAtomic(paths.taskGraphPath, taskGraph, { lock: null });
	return paths.taskGraphPath;
}

export async function updateNKleinPlanArtifactApplicationStatus(
	input: UpdateNKleinPlanArtifactApplicationStatusInput,
): Promise<NKleinPlanArtifactMetadata> {
	const artifacts = await readNKleinPlanArtifacts(input.workspacePath, input.slug);
	const metadata: NKleinPlanArtifactMetadata = {
		...artifacts.metadata,
		sourceTaskId:
			input.sourceTaskId === undefined ? artifacts.metadata.sourceTaskId : input.sourceTaskId?.trim() || null,
		applicationStatus: input.applicationStatus,
		updatedAt: input.updatedAt ?? Date.now(),
	};
	await lockedFileSystem.writeJsonFileAtomic(artifacts.metadataPath, metadata, { lock: null });
	recordSelfObservation({
		signal: "custom",
		severity: "info",
		message: `Plan artifact ${metadata.applicationStatus}: ${metadata.artifactId}`,
		taskId: metadata.sourceTaskId,
		workspacePath: input.workspacePath,
		metadata: {
			operation: "plan_artifact_lifecycle",
			stage: metadata.applicationStatus,
			artifactId: metadata.artifactId,
			planSlug: metadata.planSlug,
			applicationStatus: metadata.applicationStatus,
			validationStatus: metadata.validationStatus,
			taskCount: artifacts.taskGraph.tasks.length,
			dependencyCount: artifacts.taskGraph.tasks.reduce((total, task) => total + task.dependsOn.length, 0),
		},
	});
	return metadata;
}

export async function readNKleinPlanArtifacts(workspacePath: string, slug: string): Promise<NKleinPlanArtifacts> {
	const paths = resolveNKleinPlanArtifactPaths(workspacePath, slug);
	const [spec, plan, questionsMarkdown, decisionsMarkdown, revisionsMarkdown, summary, taskGraphRaw, metadataRaw] =
		await Promise.all([
			readFile(paths.specPath, "utf8"),
			readFile(paths.planPath, "utf8"),
			readFile(paths.questionsPath, "utf8").catch(() => ""),
			readFile(paths.decisionsPath, "utf8").catch(
				() => "# Decisions\n\nNo shared decisions have been recorded yet.\n",
			),
			readFile(paths.revisionsPath, "utf8").catch(() => formatInitialRevisionsMarkdown()),
			readFile(paths.summaryPath, "utf8").catch(() => ""),
			readFile(paths.taskGraphPath, "utf8"),
			readFile(paths.metadataPath, "utf8").catch(() => null),
		]);
	const workspaceId = await resolveWorkspaceId(workspacePath);
	const taskGraph = nkleinPlanTaskGraphSchema.parse(JSON.parse(taskGraphRaw));
	const legacyMetadata: NKleinPlanArtifactMetadata = {
		artifactId: createPlanArtifactId(paths.slug),
		workspaceId,
		workspacePath,
		sourceTaskId: null,
		artifactKind: PLAN_ARTIFACT_KIND,
		planSlug: paths.slug,
		createdAt: 0,
		updatedAt: 0,
		validationStatus: "valid",
		applicationStatus: "pending",
	};
	const metadata = metadataRaw ? nkleinPlanArtifactMetadataSchema.parse(JSON.parse(metadataRaw)) : legacyMetadata;
	return {
		metadata,
		artifactId: metadata.artifactId,
		rootPath: paths.rootPath,
		metadataPath: paths.metadataPath,
		specPath: paths.specPath,
		planPath: paths.planPath,
		questionsPath: paths.questionsPath,
		decisionsPath: paths.decisionsPath,
		revisionsPath: paths.revisionsPath,
		summaryPath: paths.summaryPath,
		taskGraphPath: paths.taskGraphPath,
		spec,
		plan,
		// F1.3a: the structured questions round-trip from questions.md (they were write-only before — hardcoded []).
		questions: parseQuestionsMarkdown(questionsMarkdown),
		questionsMarkdown,
		decisionsMarkdown,
		revisionsMarkdown,
		summary,
		taskGraph,
	};
}
