import type { BenchmarkAttemptStatus, SwebenchInstance } from "./swebench-benchmark";
import { repositoryMirrorName } from "./swebench-workspace-plan";

export interface LocalBenchmarkGradeDockerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	infrastructureFailure: boolean;
}

export interface LocalBenchmarkGradeStep {
	label: string;
	args: readonly string[];
	failureStatus: BenchmarkAttemptStatus;
}

export interface LocalBenchmarkGradeDockerPlan {
	workspaceName: string;
	setupSteps: readonly LocalBenchmarkGradeStep[];
	testStep: readonly string[];
}

function validateAbsolutePath(value: string, name: string): void {
	if (!value.startsWith("/") || value.includes("\n") || value.includes("\0")) {
		throw new Error(`${name} must be a safe absolute path.`);
	}
}

function validateRelativePath(value: string, name: string): void {
	if (
		!value ||
		value.startsWith("/") ||
		value.includes("\\") ||
		value.includes("\n") ||
		value.includes("\0") ||
		value.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new Error(`${name} must be a safe relative path.`);
	}
}

function containerBase(input: {
	image: string;
	uid: number;
	gid: number;
	mounts: readonly string[];
	workdir?: string;
}): string[] {
	return [
		"run",
		"--rm",
		"--network",
		"none",
		"--read-only",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"256",
		"--memory",
		"2g",
		"--memory-swap",
		"2g",
		"--cpus",
		"2",
		"--tmpfs",
		"/tmp:rw,noexec,nosuid,size=256m",
		"--user",
		`${input.uid}:${input.gid}`,
		"--env",
		"HOME=/tmp",
		...(input.workdir ? ["--workdir", input.workdir] : []),
		...input.mounts.flatMap((mount) => ["--volume", mount]),
		input.image,
	];
}

/** Classify only the trusted test step; setup failures retain their explicit per-step classification. */
export function classifyLocalBenchmarkTestResult(
	result: Pick<LocalBenchmarkGradeDockerResult, "exitCode" | "infrastructureFailure">,
): BenchmarkAttemptStatus {
	if (result.infrastructureFailure) return "error";
	return result.exitCode === 0 ? "resolved" : "unresolved";
}

/**
 * Build a networkless local-oracle plan. The task handed to the model never contains `localOracle`; this plan is
 * constructed only after prediction capture. Candidate patches are applied to a fresh clone, then every declared
 * oracle file is restored from the immutable bug commit and verified clean before the held-out command can run.
 */
export function buildLocalBenchmarkGradeDockerPlan(input: {
	instance: SwebenchInstance;
	repoCacheDir: string;
	workspaceParentDir: string;
	patchPath?: string;
	mode: "gold" | "candidate";
	uid: number;
	gid: number;
}): LocalBenchmarkGradeDockerPlan {
	if (input.instance.source !== "local_minted" || !input.instance.localOracle) {
		throw new Error("Local benchmark grading requires a local_minted instance with a held-out oracle.");
	}
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(input.instance.localOracle.image)) {
		throw new Error("Local benchmark grader image must use a semantic-version tag or immutable digest.");
	}
	if (!input.instance.localOracle.testCommand.trim()) {
		throw new Error("Local benchmark grading requires a non-empty held-out test command.");
	}
	validateAbsolutePath(input.repoCacheDir, "repoCacheDir");
	validateAbsolutePath(input.workspaceParentDir, "workspaceParentDir");
	if (input.patchPath) validateAbsolutePath(input.patchPath, "patchPath");
	if (input.mode === "gold" && !input.patchPath) throw new Error("Gold local benchmark grading requires a patch.");
	for (const [index, path] of input.instance.localOracle.testFiles.entries()) {
		validateRelativePath(path, `testFiles[${index}]`);
	}
	for (const [index, path] of input.instance.localOracle.solutionFiles.entries()) {
		validateRelativePath(path, `solutionFiles[${index}]`);
	}
	if (input.instance.localOracle.testFiles.length === 0) {
		throw new Error("Local benchmark grading requires at least one protected test file.");
	}
	if (input.instance.localOracle.solutionFiles.length === 0) {
		throw new Error("Local benchmark grading requires at least one solution file.");
	}
	const protectedFiles = new Set(input.instance.localOracle.testFiles);
	if (input.instance.localOracle.solutionFiles.some((path) => protectedFiles.has(path))) {
		throw new Error("Local benchmark solution files and protected test files must not overlap.");
	}
	if (!/^[0-9a-f]{7,64}$/iu.test(input.instance.baseCommit)) {
		throw new Error("Local benchmark base_commit must be a 7–64 character hexadecimal Git object id.");
	}
	const workspaceName = "grade-workspace";
	const workspacePath = `${input.workspaceParentDir}/${workspaceName}`;
	const cloneCommon = containerBase({
		image: input.instance.localOracle.image,
		uid: input.uid,
		gid: input.gid,
		mounts: [`${input.repoCacheDir}:/repo-cache:ro`, `${input.workspaceParentDir}:/output:rw`],
	});
	const gradeMounts = [`${workspacePath}:/workspace:rw`];
	if (input.patchPath) gradeMounts.push(`${input.patchPath}:/prediction/model.patch:ro`);
	const gradeCommon = containerBase({
		image: input.instance.localOracle.image,
		uid: input.uid,
		gid: input.gid,
		mounts: gradeMounts,
		workdir: "/workspace",
	});
	const steps: LocalBenchmarkGradeStep[] = [
		{
			label: "clone immutable local mirror",
			args: [
				...cloneCommon,
				"git",
				"clone",
				"--no-hardlinks",
				`/repo-cache/${repositoryMirrorName(input.instance.repo)}`,
				`/output/${workspaceName}`,
			],
			failureStatus: "error",
		},
		{
			label: "checkout bug commit",
			args: [...gradeCommon, "git", "checkout", "--detach", input.instance.baseCommit],
			failureStatus: "error",
		},
	];
	if (input.patchPath) {
		const patchFailure = input.mode === "gold" ? "error" : "unresolved";
		steps.push(
			{
				label: "validate prediction patch",
				args: [
					...gradeCommon,
					"git",
					"apply",
					"--check",
					"--whitespace=nowarn",
					...input.instance.localOracle.solutionFiles.map((path) => `--include=${path}`),
					"/prediction/model.patch",
				],
				failureStatus: patchFailure,
			},
			{
				label: "apply prediction patch",
				args: [
					...gradeCommon,
					"git",
					"apply",
					"--whitespace=nowarn",
					...input.instance.localOracle.solutionFiles.map((path) => `--include=${path}`),
					"/prediction/model.patch",
				],
				failureStatus: patchFailure,
			},
		);
	}
	steps.push(
		{
			label: "restore held-out tests",
			args: [...gradeCommon, "git", "checkout", "HEAD", "--", ...input.instance.localOracle.testFiles],
			failureStatus: "error",
		},
		{
			label: "verify held-out tests",
			args: [...gradeCommon, "git", "diff", "--exit-code", "HEAD", "--", ...input.instance.localOracle.testFiles],
			failureStatus: "error",
		},
	);
	return {
		workspaceName,
		setupSteps: steps,
		testStep: [...gradeCommon, "/bin/sh", "-lc", input.instance.localOracle.testCommand],
	};
}
