/**
 * Pure derivation of the §5.AI background-eval runner's admission SIGNALS from a snapshot of live runtime state. The
 * effectful glue (the daemon's `getSignals`) just queries `projects.list` + the model endpoint + config and hands the
 * raw numbers here; keeping the *interpretation* pure means the "is there interactive work?", "is a model loaded?",
 * "is there board headroom?" rules are one tested place, not buried in a script.
 *
 * The key rule is interactive detection: a session running in a workspace the runner does NOT own (i.e. not one of its
 * own leases) is real/targeted work, so the rail must yield. Owning is by workspace id — the runner's lease set.
 */

import type { BackgroundEvalRunnerSignals } from "./background-eval-runner.js";

export interface BackgroundEvalRunnerSignalInput {
	/** Per-project live running-session counts (from `projects.list`). */
	projects: ReadonlyArray<{ workspaceId: string; runningSessionCount: number }>;
	/** Workspace ids the runner currently owns (its in-flight leases). Anything running OUTSIDE these is interactive. */
	ownedWorkspaceIds: ReadonlySet<string>;
	/** A model is loaded + reachable at the target endpoint. */
	modelLoaded: boolean;
	/** The board's max concurrent tasks (from runtime config). */
	maxConcurrentTasks: number;
	/** Total running sessions across all projects (interactive + the runner's own). */
	totalRunningSessions: number;
}

export function computeBackgroundEvalRunnerSignals(
	input: BackgroundEvalRunnerSignalInput,
): BackgroundEvalRunnerSignals {
	const hasInteractiveWork = input.projects.some(
		(project) => project.runningSessionCount > 0 && !input.ownedWorkspaceIds.has(project.workspaceId),
	);
	return {
		hasInteractiveWork,
		loadedModelIdle: input.modelLoaded,
		resourceHeadroom: input.totalRunningSessions < Math.max(0, Math.trunc(input.maxConcurrentTasks)),
	};
}
