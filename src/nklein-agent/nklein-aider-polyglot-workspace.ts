import { access, lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AiderPolyglotTask } from "../core/aider-polyglot-benchmark";
import { buildAiderPolyglotWorkspaceDockerPlan } from "../core/aider-polyglot-workspace-plan";

export interface AiderPolyglotDockerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type AiderPolyglotDockerRunner = (args: readonly string[]) => Promise<AiderPolyglotDockerResult>;

/** Materialize only the public solution files from an explicitly pre-fetched, revision-verified corpus checkout. */
export async function materializeAiderPolyglotWorkspace(input: {
	task: AiderPolyglotTask;
	corpusDir: string;
	workspaceParentDir: string;
	image: string;
	runDocker: AiderPolyglotDockerRunner;
	uid?: number;
	gid?: number;
}): Promise<{ workspacePath: string; dockerStepCount: number }> {
	const uid = input.uid ?? process.getuid?.() ?? 1000;
	const gid = input.gid ?? process.getgid?.() ?? 1000;
	await mkdir(input.workspaceParentDir, { recursive: true });
	const workspacePath = join(input.workspaceParentDir, input.task.instanceId);
	const existing = await lstat(workspacePath)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
	if (existing) throw new Error(`Benchmark workspace already exists: ${workspacePath}`);
	const exerciseDir = join(input.corpusDir, input.task.language, "exercises", "practice", input.task.exercise);
	await access(exerciseDir).catch(() => {
		throw new Error(
			`Aider polyglot exercise ${input.task.language}/${input.task.exercise} is missing from the local corpus checkout.`,
		);
	});
	for (const path of input.task.solutionFiles) {
		await access(join(exerciseDir, path)).catch(() => {
			throw new Error(`Aider polyglot solution file is missing from the local corpus checkout: ${path}`);
		});
	}
	await mkdir(workspacePath);
	try {
		const plan = buildAiderPolyglotWorkspaceDockerPlan({
			task: input.task,
			corpusDir: input.corpusDir,
			workspaceParentDir: input.workspaceParentDir,
			image: input.image,
			uid,
			gid,
		});
		for (let index = 0; index < plan.steps.length; index += 1) {
			const result = await input.runDocker(plan.steps[index]);
			if (result.exitCode !== 0) {
				throw new Error(
					`Aider polyglot workspace Docker step ${index + 1}/${plan.steps.length} failed: ${result.stderr || result.stdout}`,
				);
			}
		}
		return { workspacePath, dockerStepCount: plan.steps.length };
	} catch (error) {
		await rm(workspacePath, { recursive: true, force: true });
		throw error;
	}
}
