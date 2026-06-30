// Pure builders for spawning an INTERACTIVE shell into a task's sandbox container (extracted from
// nklein-agent-sandbox.ts, §5.U). Shell-on-task (todo §5.A) drives a PTY via `docker exec -it` into the task's
// hardened container rather than a host worktree; when the task has no prepared sandbox the spec falls back to
// the provided host shell. Pure so the spawn decision and the `docker` argv are unit-tested.

/**
 * Interactive shell into a task's prepared sandbox container (todo §5.A: shell-on-task = `docker exec` into the
 * task's hardened container, not a host worktree). Tries a login bash, falling back to sh, so it works across
 * sandbox base images.
 */
export const DEFAULT_AGENT_SANDBOX_SHELL: readonly string[] = [
	"/bin/sh",
	"-lc",
	"exec bash -il 2>/dev/null || exec sh -il",
];

export interface AgentSandboxShellTarget {
	containerName: string;
	uid: number;
	workdir: string;
}

/**
 * Build the `docker` argv for an INTERACTIVE shell into a task's sandbox container. Mirrors the internal
 * `execAsTaskUser` exec (same task user + workdir + container) but adds `-it` to allocate a TTY and keep stdin
 * open, so a PTY can drive it. The user shell lands in the sandbox working copy, as isolated as the agent.
 */
export function buildAgentSandboxInteractiveShellArgs(
	target: AgentSandboxShellTarget,
	shell: readonly string[] = DEFAULT_AGENT_SANDBOX_SHELL,
): string[] {
	return ["exec", "-it", "-u", String(target.uid), "-w", target.workdir, target.containerName, ...shell];
}

export interface TaskShellSpawnSpec {
	binary: string;
	args: string[];
	/** True when the shell will `docker exec` into the task's sandbox container rather than a host shell. */
	usesSandbox: boolean;
}

/**
 * Decide how to spawn a shell-on-task PTY (todo §5.A): when the task has a prepared sandbox, shell INTO its
 * hardened container via `docker exec`; otherwise fall back to the provided host shell (the legacy host-worktree
 * path). Pure so the decision is unit-tested; the caller resolves the host cwd and supplies the host shell.
 */
export function buildTaskShellSpawnSpec(
	shellTarget: AgentSandboxShellTarget | null,
	hostShell: { binary: string; args?: readonly string[] },
): TaskShellSpawnSpec {
	if (shellTarget) {
		return { binary: "docker", args: buildAgentSandboxInteractiveShellArgs(shellTarget), usesSandbox: true };
	}
	return { binary: hostShell.binary, args: [...(hostShell.args ?? [])], usesSandbox: false };
}
