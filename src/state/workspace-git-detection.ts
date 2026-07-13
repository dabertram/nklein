import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeGitRepositoryInfo } from "../core/api-contract";
import { createGitProcessEnv } from "../core/git-process-env";

/**
 * Git repository DETECTION (todo §5.U — extracted from workspace-state.ts as a cohesive sibling module). A small,
 * self-contained cluster that reads repo facts (root, current/default/all branches) by shelling out to `git`. Its
 * coupling is entirely imports (execFile + the sanitized git env), no workspace-state module state, so the move is
 * behavior-preserving: workspace-state imports the two entry points it uses ({@link detectGitRootAsync} for path
 * canonicalization, {@link detectGitRepositoryInfo} for the workspace-context git block).
 */

const execFileAsync = promisify(execFile);
// Workspace resolution sits on every state read and request-scope lookup. A Git subprocess that never exits must fail
// this one lookup, not pin the workspace-index lock and every later board request/shutdown operation indefinitely.
export const WORKSPACE_GIT_DETECTION_TIMEOUT_MS = 10_000;

/**
 * Capture `git <args>` stdout (trimmed; null on empty / non-zero exit / spawn failure) WITHOUT blocking the event loop.
 * The previous synchronous `spawnSync` version blocked Node's loop the entire time git ran — fine for one-off CLI calls,
 * but catastrophic on hot server paths: `resolveWorkspacePath` AND `detectGitRepositoryInfo` both run inside
 * `loadWorkspaceContext`, i.e. on every `loadWorkspaceState`/`saveWorkspaceState` (including every board write an agent
 * makes). Under heavy parallel agent load (the agent flooding its own git + `docker exec` subprocesses) each sync git
 * spawn stalled the whole runtime for tens of seconds (the §5.AI "sluggish with 2 projects" hang — a `--cpu-prof` showed
 * the thread idle-but-blocked in the child process). Async git keeps the loop responsive.
 */
async function runGitCaptureAsync(cwd: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			encoding: "utf8",
			env: createGitProcessEnv(),
			timeout: WORKSPACE_GIT_DETECTION_TIMEOUT_MS,
		});
		const value = typeof stdout === "string" ? stdout.trim() : "";
		return value.length > 0 ? value : null;
	} catch {
		// Non-zero exit / spawn failure → null, same as the old sync path's `status !== 0` branch.
		return null;
	}
}

export async function detectGitRootAsync(cwd: string): Promise<string | null> {
	return runGitCaptureAsync(cwd, ["rev-parse", "--show-toplevel"]);
}

async function detectGitCurrentBranch(repoPath: string): Promise<string | null> {
	return runGitCaptureAsync(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

async function detectGitBranches(repoPath: string): Promise<string[]> {
	// TODO: support showing remote branches again once worktree creation can safely fetch/pull
	// and resolve missing local tracking branches automatically.
	const output = await runGitCaptureAsync(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
	if (!output) {
		return [];
	}

	const unique = new Set<string>();
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed === "HEAD") {
			continue;
		}
		unique.add(trimmed);
	}
	return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

async function detectGitDefaultBranch(repoPath: string, branches: string[]): Promise<string | null> {
	const remoteHead = await runGitCaptureAsync(repoPath, [
		"symbolic-ref",
		"--quiet",
		"--short",
		"refs/remotes/origin/HEAD",
	]);
	if (remoteHead) {
		const normalized = remoteHead.startsWith("origin/") ? remoteHead.slice("origin/".length) : remoteHead;
		if (normalized) {
			return normalized;
		}
	}
	if (branches.includes("main")) {
		return "main";
	}
	if (branches.includes("master")) {
		return "master";
	}
	return branches[0] ?? null;
}

export async function detectGitRepositoryInfo(repoPath: string): Promise<RuntimeGitRepositoryInfo> {
	const gitRoot = await detectGitRootAsync(repoPath);
	if (!gitRoot) {
		throw new Error(`No git repository detected at ${repoPath}`);
	}

	// currentBranch + branches are independent — run them concurrently to cut the number of serial git spawns.
	const [currentBranch, branches] = await Promise.all([detectGitCurrentBranch(repoPath), detectGitBranches(repoPath)]);
	const orderedBranches = currentBranch && !branches.includes(currentBranch) ? [currentBranch, ...branches] : branches;
	const defaultBranch = await detectGitDefaultBranch(repoPath, orderedBranches);

	return {
		currentBranch,
		defaultBranch,
		branches: orderedBranches,
	};
}
