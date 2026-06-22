import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { createGitProcessEnv } from "../core/git-process-env";
import { runGit as defaultRunGit, type RunGitOptions } from "./git-utils";
import { classifyTaskPatchCaptureFailure, TaskPatchCaptureError } from "./task-patch-capture-diagnostics";

const TASK_RESULT_BRANCH_PREFIX = "nklein/tasks";

type RunGit = (cwd: string, args: string[], options?: RunGitOptions) => ReturnType<typeof defaultRunGit>;

export interface TaskResultBranch {
	taskId: string;
	branchName: string;
	refName: string;
	baseCommit: string;
	headCommit: string;
}

export interface ApplyTaskPatchToResultBranchInput {
	repoPath: string;
	taskId: string;
	baseRef: string;
	patch: string;
	message?: string;
	runGit?: RunGit;
}

export function createTaskResultBranchName(taskId: string): string {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		throw new Error("Task id is required for task result branch.");
	}
	const slug =
		normalizedTaskId
			.replace(/[^A-Za-z0-9._-]+/gu, "-")
			.replace(/\.{2,}/gu, ".")
			.replace(/^[.-]+/u, "")
			.replace(/[.-]+$/u, "")
			.slice(0, 80) || "task";
	const safeSlug = slug.endsWith(".lock") ? `${slug.slice(0, -5)}-lock` : slug;
	const hash = createHash("sha256").update(normalizedTaskId).digest("hex").slice(0, 10);
	return `${TASK_RESULT_BRANCH_PREFIX}/${safeSlug}-${hash}`;
}

export function createTaskResultBranchRef(taskId: string): string {
	return `refs/heads/${createTaskResultBranchName(taskId)}`;
}

export async function resolveTaskResultBranchCommit(input: {
	repoPath: string;
	taskId: string;
	runGit?: RunGit;
}): Promise<string | null> {
	const runGit = input.runGit ?? defaultRunGit;
	const result = await runGit(input.repoPath, [
		"rev-parse",
		"--verify",
		`${createTaskResultBranchRef(input.taskId)}^{commit}`,
	]);
	return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
}

/**
 * The unified diff of a task's result branch against its base ref — the worker's completed change, used as the
 * input to the second-opinion review (todo §5.K). Returns null when the result branch is absent or empty.
 */
export async function getTaskResultBranchDiff(input: {
	repoPath: string;
	taskId: string;
	baseRef: string;
	runGit?: RunGit;
}): Promise<string | null> {
	const runGit = input.runGit ?? defaultRunGit;
	const headCommit = await resolveTaskResultBranchCommit({
		repoPath: input.repoPath,
		taskId: input.taskId,
		runGit,
	});
	if (!headCommit) {
		return null;
	}
	const baseCommit = await runGit(input.repoPath, ["rev-parse", "--verify", `${input.baseRef}^{commit}`]);
	const fromRef = baseCommit.ok && baseCommit.stdout.trim() ? baseCommit.stdout.trim() : input.baseRef;
	const diff = await runGit(input.repoPath, ["diff", fromRef, headCommit]);
	if (!diff.ok) {
		return null;
	}
	const text = diff.stdout.trim();
	return text ? text : null;
}

export async function deleteTaskResultBranch(input: {
	repoPath: string;
	taskId: string;
	runGit?: RunGit;
}): Promise<boolean> {
	const runGit = input.runGit ?? defaultRunGit;
	const refName = createTaskResultBranchRef(input.taskId);
	const existing = await runGit(input.repoPath, ["rev-parse", "--verify", `${refName}^{commit}`]);
	if (!existing.ok) {
		return false;
	}
	const deleted = await runGit(input.repoPath, ["update-ref", "-d", refName]);
	if (!deleted.ok) {
		throw new Error(deleted.error ?? `Could not delete task result branch "${refName}".`);
	}
	return true;
}

export async function deleteTaskResultBranchesForRepo(input: { repoPath: string; runGit?: RunGit }): Promise<number> {
	const runGit = input.runGit ?? defaultRunGit;
	const refs = await runGit(input.repoPath, [
		"for-each-ref",
		"--format=%(refname)",
		`refs/heads/${TASK_RESULT_BRANCH_PREFIX}`,
	]);
	if (!refs.ok || !refs.stdout.trim()) {
		return 0;
	}
	let deletedCount = 0;
	for (const refName of refs.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)) {
		const deleted = await runGit(input.repoPath, ["update-ref", "-d", refName]);
		if (!deleted.ok) {
			throw new Error(deleted.error ?? `Could not delete task result branch "${refName}".`);
		}
		deletedCount += 1;
	}
	return deletedCount;
}

/**
 * Persists a failed sandbox task patch to a durable runtime-home location so a corrupt/non-applying diff can
 * be inspected after the temp working dir is cleaned up (follow-up-6 §3.5). Best-effort: a preservation
 * failure must not mask the original capture failure, so this returns null instead of throwing.
 */
async function preserveFailedTaskPatch(taskId: string, patch: string): Promise<string | null> {
	try {
		const dir = join(resolveNkleinRuntimeHomePath(homedir()), "patch-failures");
		await mkdir(dir, { recursive: true });
		const safeTaskId = taskId.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80) || "task";
		const patchPath = join(dir, `${safeTaskId}-${Date.now()}.patch`);
		await writeFile(patchPath, `${patch.trimEnd()}\n`, "utf8");
		return patchPath;
	} catch {
		return null;
	}
}

export async function applyTaskPatchToResultBranch(
	input: ApplyTaskPatchToResultBranchInput,
): Promise<TaskResultBranch | null> {
	const normalizedPatch = input.patch.trimEnd();
	if (!normalizedPatch) {
		return null;
	}
	const runGit = input.runGit ?? defaultRunGit;
	const baseCommitResult = await runGit(input.repoPath, ["rev-parse", "--verify", `${input.baseRef}^{commit}`]);
	if (!baseCommitResult.ok || !baseCommitResult.stdout.trim()) {
		throw new Error(baseCommitResult.error ?? `Could not resolve base ref "${input.baseRef}".`);
	}
	const baseCommit = baseCommitResult.stdout.trim();
	const baseTreeResult = await runGit(input.repoPath, ["rev-parse", "--verify", `${baseCommit}^{tree}`]);
	if (!baseTreeResult.ok || !baseTreeResult.stdout.trim()) {
		throw new Error(baseTreeResult.error ?? `Could not resolve tree for base commit "${baseCommit}".`);
	}

	const tempDir = await mkdtemp(join(tmpdir(), "nklein-task-result-"));
	const indexPath = join(tempDir, "index");
	const patchPath = join(tempDir, "task.patch");
	const env = {
		...createGitProcessEnv(),
		GIT_INDEX_FILE: indexPath,
	};
	try {
		await writeFile(patchPath, `${normalizedPatch}\n`, "utf8");
		const readTree = await runGit(input.repoPath, ["read-tree", baseCommit], { env });
		if (!readTree.ok) {
			throw new Error(readTree.error ?? "Could not initialize task result index.");
		}
		const apply = await runGit(input.repoPath, ["apply", "--cached", "--binary", "--whitespace=nowarn", patchPath], {
			env,
		});
		if (!apply.ok) {
			const gitError = apply.error ?? "Could not apply sandbox task patch.";
			const details = classifyTaskPatchCaptureFailure(gitError, normalizedPatch);
			const preservedPatchPath = await preserveFailedTaskPatch(input.taskId, normalizedPatch);
			throw new TaskPatchCaptureError({ taskId: input.taskId, preservedPatchPath, ...details });
		}
		const tree = await runGit(input.repoPath, ["write-tree"], { env });
		if (!tree.ok || !tree.stdout.trim()) {
			throw new Error(tree.error ?? "Could not write task result tree.");
		}
		if (tree.stdout.trim() === baseTreeResult.stdout.trim()) {
			return null;
		}
		const message = input.message?.trim() || `Apply !Klein task result for ${input.taskId}`;
		const commit = await runGit(
			input.repoPath,
			["commit-tree", tree.stdout.trim(), "-p", baseCommit, "-m", message],
			{
				env,
			},
		);
		if (!commit.ok || !commit.stdout.trim()) {
			throw new Error(commit.error ?? "Could not create task result commit.");
		}
		const refName = createTaskResultBranchRef(input.taskId);
		const updateRef = await runGit(input.repoPath, ["update-ref", refName, commit.stdout.trim()]);
		if (!updateRef.ok) {
			throw new Error(updateRef.error ?? `Could not update task result branch "${refName}".`);
		}
		return {
			taskId: input.taskId,
			branchName: createTaskResultBranchName(input.taskId),
			refName,
			baseCommit,
			headCommit: commit.stdout.trim(),
		};
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
}
