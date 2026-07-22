import { createHash } from "node:crypto";
import { runGit as defaultRunGit } from "./git-utils";

type RunGit = typeof defaultRunGit;

export interface SealedBenchmarkWorkspace {
	baseCommit: string;
	headCommit: string;
}

export interface CapturedBenchmarkResult {
	baseCommit: string;
	resultCommit: string;
	evidenceRef: string;
	patch: string;
}

function evidenceRef(runId: string): string {
	const normalized = runId.trim();
	if (!normalized) throw new Error("Benchmark run id is required for result evidence.");
	const slug =
		normalized
			.replace(/[^A-Za-z0-9._-]+/gu, "-")
			.replace(/\.{2,}/gu, ".")
			.replace(/^[.-]+|[.-]+$/gu, "")
			.slice(0, 80) || "run";
	const safeSlug = slug.endsWith(".lock") ? `${slug.slice(0, -5)}-lock` : slug;
	const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 10);
	return `refs/nklein/benchmark-evidence/${safeSlug}-${hash}`;
}

async function requireGit(input: {
	repoPath: string;
	args: string[];
	runGit: RunGit;
	message: string;
	trimStdout?: boolean;
}): Promise<string> {
	const result = await input.runGit(input.repoPath, input.args, {
		...(input.trimStdout === false ? { trimStdout: false } : {}),
	});
	if (!result.ok) throw new Error(`${input.message}: ${result.error ?? result.stderr}`);
	return result.stdout;
}

/** Refuse any workspace that is not the pristine, one-commit, oracle-free baseline produced by the materializer. */
export async function verifySealedBenchmarkWorkspace(input: {
	repoPath: string;
	baseRef?: string;
	runGit?: RunGit;
}): Promise<SealedBenchmarkWorkspace> {
	const runGit = input.runGit ?? defaultRunGit;
	const baseRef = input.baseRef ?? "benchmark-baseline";
	const baseCommit = await requireGit({
		repoPath: input.repoPath,
		args: ["rev-parse", "--verify", `${baseRef}^{commit}`],
		runGit,
		message: `Benchmark base ref ${baseRef} is missing`,
	});
	const headCommit = await requireGit({
		repoPath: input.repoPath,
		args: ["rev-parse", "--verify", "HEAD^{commit}"],
		runGit,
		message: "Benchmark workspace has no HEAD commit",
	});
	if (headCommit !== baseCommit) {
		throw new Error("Benchmark workspace is not pristine: HEAD differs from the sealed baseline.");
	}
	const commitCount = await requireGit({
		repoPath: input.repoPath,
		args: ["rev-list", "--count", headCommit],
		runGit,
		message: "Could not count benchmark baseline history",
	});
	if (commitCount !== "1") {
		throw new Error(`Benchmark workspace must expose exactly one sealed commit, found ${commitCount || "unknown"}.`);
	}
	const subject = await requireGit({
		repoPath: input.repoPath,
		args: ["show", "-s", "--format=%s", headCommit],
		runGit,
		message: "Could not inspect benchmark baseline commit",
	});
	if (subject !== "sealed upstream baseline") {
		throw new Error(`Benchmark workspace has an unexpected baseline commit: ${subject || "(empty)"}.`);
	}
	const status = await requireGit({
		repoPath: input.repoPath,
		args: ["status", "--porcelain=v1", "--untracked-files=all"],
		runGit,
		message: "Could not inspect benchmark workspace cleanliness",
	});
	if (status) throw new Error("Benchmark workspace is not pristine: tracked or untracked changes are present.");
	return { baseCommit, headCommit };
}

/**
 * Snapshot the terminal aggregate workspace tree under a durable hidden ref, then diff exact commits. This supports both
 * ACT-mode single-card runs and plan-mode DAGs whose reviewed child results were merged into the workspace in order.
 */
export async function captureBenchmarkWorkspaceResult(input: {
	repoPath: string;
	baseCommit: string;
	runId: string;
	runGit?: RunGit;
}): Promise<CapturedBenchmarkResult> {
	const runGit = input.runGit ?? defaultRunGit;
	const resultCommit = await requireGit({
		repoPath: input.repoPath,
		args: ["rev-parse", "--verify", "HEAD^{commit}"],
		runGit,
		message: "Benchmark result has no HEAD commit",
	});
	await requireGit({
		repoPath: input.repoPath,
		args: ["merge-base", "--is-ancestor", input.baseCommit, resultCommit],
		runGit,
		message: "Benchmark result is not descended from its sealed baseline",
	});
	const status = await requireGit({
		repoPath: input.repoPath,
		args: ["status", "--porcelain=v1", "--untracked-files=all"],
		runGit,
		message: "Could not inspect benchmark result cleanliness",
	});
	if (status) throw new Error("Benchmark result workspace is dirty; refusing to score an unsettled artifact.");
	const ref = evidenceRef(input.runId);
	await requireGit({
		repoPath: input.repoPath,
		args: ["update-ref", ref, resultCommit, "0000000000000000000000000000000000000000"],
		runGit,
		message: `Could not pin benchmark evidence ref ${ref}`,
	});
	const patch = await requireGit({
		repoPath: input.repoPath,
		args: ["diff", "--binary", input.baseCommit, resultCommit],
		runGit,
		message: "Could not capture benchmark result diff",
		trimStdout: false,
	});
	return { baseCommit: input.baseCommit, resultCommit, evidenceRef: ref, patch };
}
