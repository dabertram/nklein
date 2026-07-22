import type { SwebenchInstance } from "./swebench-benchmark";

export interface SwebenchWorkspaceDockerPlan {
	repositoryMirrorName: string;
	workspaceName: string;
	steps: readonly (readonly string[])[];
}

function validateAbsolutePath(value: string, name: string): void {
	if (!value.startsWith("/")) throw new Error(`${name} must be an absolute path.`);
	if (value.includes("\n") || value.includes("\0")) throw new Error(`${name} contains an invalid character.`);
}

function repositoryMirrorName(repo: string): string {
	if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repo)) {
		throw new Error("Benchmark repo must be an owner/name GitHub-style slug.");
	}
	return `${repo.replace("/", "__")}.git`;
}

export function resolveSwebenchWorkspaceName(instanceId: string): string {
	if (!/^[a-zA-Z0-9_.-]+$/u.test(instanceId)) {
		throw new Error("Benchmark instance_id contains characters unsafe for a workspace name.");
	}
	return instanceId;
}

function containerBase(input: { image: string; uid: number; gid: number; mounts: readonly string[] }): string[] {
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
		"/tmp:rw,noexec,nosuid,size=64m",
		"--user",
		`${input.uid}:${input.gid}`,
		"--env",
		"HOME=/tmp",
		...input.mounts.flatMap((mount) => ["--volume", mount]),
		input.image,
	];
}

/**
 * Build argv-only Docker steps. No shell is involved and every mutable repository operation stays in `--network none`.
 * Oracle artifacts are deliberately absent: `test_patch` belongs exclusively to the external official grader and must
 * never be mounted, applied, committed, or otherwise exposed in the agent-visible workspace.
 */
export function buildSwebenchWorkspaceDockerPlan(input: {
	instance: SwebenchInstance;
	repoCacheDir: string;
	workspaceParentDir: string;
	image: string;
	uid: number;
	gid: number;
}): SwebenchWorkspaceDockerPlan {
	validateAbsolutePath(input.repoCacheDir, "repoCacheDir");
	validateAbsolutePath(input.workspaceParentDir, "workspaceParentDir");
	if (!/^\p{ASCII}{7,64}$/u.test(input.instance.baseCommit) || !/^[0-9a-f]+$/iu.test(input.instance.baseCommit)) {
		throw new Error("Benchmark base_commit must be a 7–64 character hexadecimal Git object id.");
	}
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(input.image)) {
		throw new Error(
			"Benchmark workspace image must end in a semantic-version tag or immutable sha256 digest (never latest).",
		);
	}
	const mirror = repositoryMirrorName(input.instance.repo);
	const workspace = resolveSwebenchWorkspaceName(input.instance.instanceId);
	const cacheMount = `${input.repoCacheDir}:/repo-cache:ro`;
	const parentMount = `${input.workspaceParentDir}:/output:rw`;
	const workspaceMount = `${input.workspaceParentDir}/${workspace}:/workspace:rw`;
	const common = (mounts: readonly string[]) =>
		containerBase({ image: input.image, uid: input.uid, gid: input.gid, mounts });

	const steps: string[][] = [
		[
			...common([cacheMount, parentMount]),
			"git",
			"clone",
			"--no-hardlinks",
			`/repo-cache/${mirror}`,
			`/output/${workspace}`,
		],
		[...common([workspaceMount]), "git", "-C", "/workspace", "checkout", "--detach", input.instance.baseCommit],
		[...common([workspaceMount]), "rm", "-rf", "/workspace/.git"],
		[...common([workspaceMount]), "git", "-C", "/workspace", "init", "--initial-branch=benchmark-baseline"],
		[...common([workspaceMount]), "sed", "-i", "-e", "$a.nklein/", "/workspace/.git/info/exclude"],
		[...common([workspaceMount]), "git", "-C", "/workspace", "add", "--all"],
		[
			...common([workspaceMount]),
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
	return { repositoryMirrorName: mirror, workspaceName: workspace, steps };
}
