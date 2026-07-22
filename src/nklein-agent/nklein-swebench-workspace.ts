import { access, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SwebenchInstance } from "../core/swebench-benchmark";
import { buildSwebenchWorkspaceDockerPlan } from "../core/swebench-workspace-plan";

export interface SwebenchDockerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type SwebenchDockerRunner = (args: readonly string[]) => Promise<SwebenchDockerResult>;

/**
 * Materialize one sealed benchmark workspace from a pre-fetched local bare mirror. The dataset and repository fetch are
 * deliberately absent: they are the egress-gated operator step. Every Git mutation runs in the hardened sandbox image.
 */
export async function materializeSwebenchWorkspace(input: {
	instance: SwebenchInstance;
	repoCacheDir: string;
	workspaceParentDir: string;
	image: string;
	runDocker: SwebenchDockerRunner;
	uid?: number;
	gid?: number;
}): Promise<{ workspacePath: string; dockerStepCount: number }> {
	const uid = input.uid ?? process.getuid?.() ?? 1000;
	const gid = input.gid ?? process.getgid?.() ?? 1000;
	await mkdir(input.workspaceParentDir, { recursive: true });
	const workspacePath = join(input.workspaceParentDir, input.instance.instanceId);
	const existing = await lstat(workspacePath)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
	if (existing) throw new Error(`Benchmark workspace already exists: ${workspacePath}`);
	const patchDir = await mkdtemp(
		join(input.workspaceParentDir, `.nklein-benchmark-input-${input.instance.instanceId}-`),
	);
	try {
		const plan = buildSwebenchWorkspaceDockerPlan({
			instance: input.instance,
			repoCacheDir: input.repoCacheDir,
			workspaceParentDir: input.workspaceParentDir,
			patchDir,
			image: input.image,
			uid,
			gid,
		});
		await access(join(input.repoCacheDir, plan.repositoryMirrorName)).catch(() => {
			throw new Error(
				`Local bare mirror ${plan.repositoryMirrorName} is missing. Fetching is an explicit egress-gated operator step.`,
			);
		});
		await writeFile(join(patchDir, "test.patch"), input.instance.testPatch, { mode: 0o600, flag: "wx" });
		for (let index = 0; index < plan.steps.length; index += 1) {
			const result = await input.runDocker(plan.steps[index]);
			if (result.exitCode !== 0) {
				throw new Error(
					`Benchmark workspace Docker step ${index + 1}/${plan.steps.length} failed: ${result.stderr || result.stdout}`,
				);
			}
		}
		return { workspacePath, dockerStepCount: plan.steps.length };
	} catch (error) {
		// A half-built workspace is not a valid benchmark input. Remove only the exact instance path we derived and own.
		await rm(workspacePath, { recursive: true, force: true });
		throw error;
	} finally {
		// The test patch is an oracle artifact and must never persist beside the agent-visible workspace.
		await rm(patchDir, { recursive: true, force: true });
	}
}
