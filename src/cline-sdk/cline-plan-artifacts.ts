import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { lockedFileSystem } from "../fs/locked-file-system";

export const clinePlanTaskSchema = z.object({
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
});
export type ClinePlanTask = z.infer<typeof clinePlanTaskSchema>;

export const clinePlanTaskGraphSchema = z.object({
	schemaVersion: z.literal(1),
	slug: z.string().min(1),
	title: z.string().min(1),
	tasks: z.array(clinePlanTaskSchema),
});
export type ClinePlanTaskGraph = z.infer<typeof clinePlanTaskGraphSchema>;

export const clinePlanQuestionOptionSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	description: z.string().nullable().default(null),
	recommended: z.boolean().default(false),
});
export type ClinePlanQuestionOption = z.infer<typeof clinePlanQuestionOptionSchema>;

export const clinePlanQuestionSchema = z.object({
	id: z.string().min(1),
	question: z.string().min(1),
	status: z.enum(["open", "answered", "assumed-default"]),
	options: z.array(clinePlanQuestionOptionSchema).default([]),
	answer: z.string().nullable().default(null),
	assumption: z.string().nullable().default(null),
});
export type ClinePlanQuestion = z.infer<typeof clinePlanQuestionSchema>;

export interface ClinePlanArtifacts {
	rootPath: string;
	specPath: string;
	planPath: string;
	questionsPath: string;
	decisionsPath: string;
	revisionsPath: string;
	summaryPath: string;
	taskGraphPath: string;
	spec: string;
	plan: string;
	questions: ClinePlanQuestion[];
	questionsMarkdown: string;
	decisionsMarkdown: string;
	revisionsMarkdown: string;
	summary: string;
	taskGraph: ClinePlanTaskGraph;
}

export interface WriteClinePlanArtifactsInput {
	workspacePath: string;
	slug: string;
	spec: string;
	plan: string;
	questions?: ClinePlanQuestion[];
	decisions?: string | null;
	revisions?: string | null;
	summary?: string | null;
	taskGraph: ClinePlanTaskGraph;
}

function formatQuestionsMarkdown(questions: readonly ClinePlanQuestion[]): string {
	if (questions.length === 0) {
		return "# Questions\n\nNo clarifying questions were recorded.\n";
	}
	const sections = ["# Questions"];
	for (const question of questions) {
		const lines = [`## ${question.id}`, "", `Status: ${question.status}`, "", question.question.trim()];
		if (question.options.length > 0) {
			lines.push("", "Options:");
			for (const option of question.options) {
				const recommended = option.recommended ? " (recommended)" : "";
				const description = option.description?.trim() ? ` - ${option.description.trim()}` : "";
				lines.push(`- ${option.id}: ${option.label}${recommended}${description}`);
			}
		}
		if (question.answer?.trim()) {
			lines.push("", `Answer: ${question.answer.trim()}`);
		}
		if (question.assumption?.trim()) {
			lines.push("", `Assumption: ${question.assumption.trim()}`);
		}
		sections.push(lines.join("\n"));
	}
	return `${sections.join("\n\n")}\n`;
}

function formatInitialDecisionsMarkdown(questions: readonly ClinePlanQuestion[]): string {
	const decisions = questions.filter((question) => question.answer?.trim() || question.assumption?.trim());
	if (decisions.length === 0) {
		return "# Decisions\n\nNo shared decisions have been recorded yet.\n";
	}
	const sections = ["# Decisions"];
	for (const question of decisions) {
		const lines = [`## ${question.id}`, "", question.question.trim()];
		if (question.answer?.trim()) {
			lines.push("", `Decision: ${question.answer.trim()}`);
		}
		if (question.assumption?.trim()) {
			lines.push("", `Assumption: ${question.assumption.trim()}`);
		}
		sections.push(lines.join("\n"));
	}
	return `${sections.join("\n\n")}\n`;
}

function formatInitialRevisionsMarkdown(): string {
	return "# Revisions\n\nNo plan revisions have been recorded yet.\n";
}

function slugify(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug) {
		throw new Error("Plan slug cannot be empty.");
	}
	return slug;
}

export function resolveClinePlanArtifactPaths(
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
	slug: string;
} {
	const slug = slugify(rawSlug);
	const rootPath = join(workspacePath, ".cline", "kanban", "plans", slug);
	return {
		rootPath,
		specPath: join(rootPath, "spec.md"),
		planPath: join(rootPath, "plan.md"),
		questionsPath: join(rootPath, "questions.md"),
		decisionsPath: join(rootPath, "decisions.md"),
		revisionsPath: join(rootPath, "revisions.md"),
		summaryPath: join(rootPath, "summary.md"),
		taskGraphPath: join(rootPath, "tasks.json"),
		slug,
	};
}

export async function writeClinePlanArtifacts(input: WriteClinePlanArtifactsInput): Promise<ClinePlanArtifacts> {
	const paths = resolveClinePlanArtifactPaths(input.workspacePath, input.slug);
	const taskGraph = clinePlanTaskGraphSchema.parse({
		...input.taskGraph,
		slug: paths.slug,
	});
	const questions = z.array(clinePlanQuestionSchema).parse(input.questions ?? []);
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
	return {
		rootPath: paths.rootPath,
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

export async function readClinePlanArtifacts(workspacePath: string, slug: string): Promise<ClinePlanArtifacts> {
	const paths = resolveClinePlanArtifactPaths(workspacePath, slug);
	const [spec, plan, questionsMarkdown, decisionsMarkdown, revisionsMarkdown, summary, taskGraphRaw] =
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
		]);
	return {
		rootPath: paths.rootPath,
		specPath: paths.specPath,
		planPath: paths.planPath,
		questionsPath: paths.questionsPath,
		decisionsPath: paths.decisionsPath,
		revisionsPath: paths.revisionsPath,
		summaryPath: paths.summaryPath,
		taskGraphPath: paths.taskGraphPath,
		spec,
		plan,
		questions: [],
		questionsMarkdown,
		decisionsMarkdown,
		revisionsMarkdown,
		summary,
		taskGraph: clinePlanTaskGraphSchema.parse(JSON.parse(taskGraphRaw)),
	};
}
