import type { AiderPolyglotTask } from "./aider-polyglot-benchmark";

export interface AiderPolyglotWorkspaceDockerPlan {
	workspaceName: string;
	steps: readonly (readonly string[])[];
}

function validateAbsolutePath(value: string, name: string): void {
	if (!value.startsWith("/") || value.includes("\n") || value.includes("\0")) {
		throw new Error(`${name} must be a safe absolute path.`);
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
		"128",
		"--memory",
		"1g",
		"--memory-swap",
		"1g",
		"--cpus",
		"1",
		"--tmpfs",
		"/tmp:rw,noexec,nosuid,size=32m",
		"--user",
		`${input.uid}:${input.gid}`,
		"--env",
		"HOME=/tmp",
		...input.mounts.flatMap((mount) => ["--volume", mount]),
		...(input.workdir ? ["--workdir", input.workdir] : []),
		input.image,
	];
}

/** Build a solution-files-only workspace. Tests, examples, metadata, and docs never enter agent-visible storage. */
export function buildAiderPolyglotWorkspaceDockerPlan(input: {
	task: AiderPolyglotTask;
	corpusDir: string;
	workspaceParentDir: string;
	image: string;
	uid: number;
	gid: number;
}): AiderPolyglotWorkspaceDockerPlan {
	validateAbsolutePath(input.corpusDir, "corpusDir");
	validateAbsolutePath(input.workspaceParentDir, "workspaceParentDir");
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(input.image)) {
		throw new Error("Aider polyglot workspace image must use a semantic-version tag or immutable digest.");
	}
	const sourceDir = `${input.corpusDir}/${input.task.language}/exercises/practice/${input.task.exercise}`;
	const workspaceDir = `${input.workspaceParentDir}/${input.task.instanceId}`;
	const mounts = [`${sourceDir}:/source:ro`, `${workspaceDir}:/workspace:rw`];
	const common = containerBase({ image: input.image, uid: input.uid, gid: input.gid, mounts });
	const copy = containerBase({ image: input.image, uid: input.uid, gid: input.gid, mounts, workdir: "/source" });
	const copySteps = input.task.solutionFiles.map((path) => [...copy, "cp", "--parents", "--", path, "/workspace"]);
	const steps: string[][] = [
		...copySteps,
		[...common, "git", "-C", "/workspace", "init", "--initial-branch=benchmark-baseline"],
		[...common, "sed", "-i", "-e", "$a.nklein/", "/workspace/.git/info/exclude"],
		[...common, "git", "-C", "/workspace", "add", "--all"],
		[
			...common,
			"git",
			"-C",
			"/workspace",
			"-c",
			"user.name=!Klein Benchmark",
			"-c",
			"user.email=benchmark@localhost",
			"commit",
			"--quiet",
			"--message",
			"sealed upstream baseline",
		],
	];
	return { workspaceName: input.task.instanceId, steps };
}
