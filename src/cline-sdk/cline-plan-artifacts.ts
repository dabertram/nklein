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

export interface ClinePlanArtifacts {
	rootPath: string;
	specPath: string;
	planPath: string;
	taskGraphPath: string;
	spec: string;
	plan: string;
	taskGraph: ClinePlanTaskGraph;
}

export interface WriteClinePlanArtifactsInput {
	workspacePath: string;
	slug: string;
	spec: string;
	plan: string;
	taskGraph: ClinePlanTaskGraph;
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
	taskGraphPath: string;
	slug: string;
} {
	const slug = slugify(rawSlug);
	const rootPath = join(workspacePath, ".cline", "kanban", "plans", slug);
	return {
		rootPath,
		specPath: join(rootPath, "spec.md"),
		planPath: join(rootPath, "plan.md"),
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
	await mkdir(paths.rootPath, { recursive: true });
	await lockedFileSystem.writeTextFileAtomic(paths.specPath, `${input.spec.trimEnd()}\n`, { lock: null });
	await lockedFileSystem.writeTextFileAtomic(paths.planPath, `${input.plan.trimEnd()}\n`, { lock: null });
	await lockedFileSystem.writeJsonFileAtomic(paths.taskGraphPath, taskGraph, { lock: null });
	return {
		rootPath: paths.rootPath,
		specPath: paths.specPath,
		planPath: paths.planPath,
		taskGraphPath: paths.taskGraphPath,
		spec: input.spec,
		plan: input.plan,
		taskGraph,
	};
}

export async function readClinePlanArtifacts(workspacePath: string, slug: string): Promise<ClinePlanArtifacts> {
	const paths = resolveClinePlanArtifactPaths(workspacePath, slug);
	const [spec, plan, taskGraphRaw] = await Promise.all([
		readFile(paths.specPath, "utf8"),
		readFile(paths.planPath, "utf8"),
		readFile(paths.taskGraphPath, "utf8"),
	]);
	return {
		rootPath: paths.rootPath,
		specPath: paths.specPath,
		planPath: paths.planPath,
		taskGraphPath: paths.taskGraphPath,
		spec,
		plan,
		taskGraph: clinePlanTaskGraphSchema.parse(JSON.parse(taskGraphRaw)),
	};
}
