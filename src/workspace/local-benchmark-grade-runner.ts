import { access, lstat } from "node:fs/promises";
import { join } from "node:path";
import {
	buildLocalBenchmarkGradeDockerPlan,
	classifyLocalBenchmarkTestResult,
	type LocalBenchmarkGradeDockerResult,
} from "../core/local-benchmark-grade-plan";
import type { BenchmarkAttemptStatus, SwebenchInstance } from "../core/swebench-benchmark";
import { repositoryMirrorName } from "../core/swebench-workspace-plan";

export type LocalBenchmarkDockerRunner = (args: readonly string[]) => Promise<LocalBenchmarkGradeDockerResult>;

export interface LocalBenchmarkGradeResult {
	status: BenchmarkAttemptStatus;
	workspacePath: string;
	log: string;
}

/** Execute one post-capture local grade while keeping the complete oracle outside the agent-visible task boundary. */
export async function gradeLocalBenchmark(input: {
	instance: SwebenchInstance;
	repoCacheDir: string;
	workspaceParentDir: string;
	patchPath?: string;
	mode: "gold" | "candidate";
	runDocker: LocalBenchmarkDockerRunner;
	uid?: number;
	gid?: number;
}): Promise<LocalBenchmarkGradeResult> {
	const plan = buildLocalBenchmarkGradeDockerPlan({
		instance: input.instance,
		repoCacheDir: input.repoCacheDir,
		workspaceParentDir: input.workspaceParentDir,
		...(input.patchPath ? { patchPath: input.patchPath } : {}),
		mode: input.mode,
		uid: input.uid ?? process.getuid?.() ?? 1000,
		gid: input.gid ?? process.getgid?.() ?? 1000,
	});
	const workspacePath = join(input.workspaceParentDir, plan.workspaceName);
	const exists = await lstat(workspacePath)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
	if (exists) throw new Error(`Local benchmark grade workspace already exists: ${workspacePath}`);
	await access(join(input.repoCacheDir, repositoryMirrorName(input.instance.repo))).catch(() => {
		throw new Error("Local benchmark mirror is missing; grading never fetches repositories from the network.");
	});
	let log = "";
	for (let index = 0; index < plan.setupSteps.length; index += 1) {
		const step = plan.setupSteps[index];
		const result = await input.runDocker(step.args);
		log += `setup ${index + 1}/${plan.setupSteps.length}: ${step.label}\n${result.stdout}${result.stderr}`;
		if (result.exitCode !== 0 || result.infrastructureFailure) {
			const status = result.infrastructureFailure ? "error" : step.failureStatus;
			return { status, workspacePath, log: `${log}\nsetup failed\n` };
		}
	}
	const test = await input.runDocker(plan.testStep);
	log += `test: held-out local oracle\n${test.stdout}${test.stderr}`;
	return { status: classifyLocalBenchmarkTestResult(test), workspacePath, log };
}
