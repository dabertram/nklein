import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";

/**
 * Service touchpoints. The synthetic (`::review`/`::plan-critique`/…) session's per-task state (launch config,
 * provider id, model endpoint, context-budget inputs, sandbox state) is service-owned; `forgetSyntheticState` bundles
 * the exact teardown-forgets each runner performed inline.
 */
export interface SecondarySessionHarnessDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	setSandbox(syntheticTaskId: string, projectRepoPath: string, baseRef: string): void;
	clearTaskSessions(syntheticTaskId: string): Promise<unknown>;
	forgetSyntheticState(syntheticTaskId: string): void;
}

/** Passed to a runner's `drive` closure: the prepared sandbox workspace + a deadline-bounded turn runner. */
export type SecondaryTurnOutcome = "settled" | "error" | "timeout";

export interface SecondarySessionContext {
	workspace: { workdir: string };
	/** Absolute deadline (ms epoch) for the whole session — runners gate their nudge loops on `Date.now() < deadlineMs`. */
	deadlineMs: number;
	/**
	 * Await one turn, bounded by the remaining overall budget (an SDK turn can hang). Turn errors are recorded (not
	 * thrown) so they fall through to whatever null/empty verdict the drive returns (the caller then fail-safe-delivers).
	 */
	runBoundedTurn(turn: Promise<unknown>): Promise<SecondaryTurnOutcome>;
}

export interface SecondarySessionConfig {
	/**
	 * The PRIMARY (worker) task id. When provided, the harness resolves the DELIVERED result-branch commit and uses it
	 * (falling back to `baseRef`) — the review runner wants this. Omit it to check out `baseRef` directly (plan-critique
	 * / merge / mirror pass their own ref: the source-card base, the main ref, etc.).
	 */
	primaryTaskId?: string;
	/** The synthetic `<primary>::<kind>` id owning this bounded session's workspace + state. */
	syntheticTaskId: string;
	projectRepoPath: string;
	baseRef: string;
	timeoutMs?: number;
	defaultTimeoutMs: number;
	/** Label for the per-turn error observation, e.g. "Second-opinion reviewer session". */
	errorLabel: string;
}

export interface SecondarySessionHarness {
	runBracketed<T>(
		config: SecondarySessionConfig,
		drive: (ctx: SecondarySessionContext) => Promise<T>,
	): Promise<T | null>;
}

/**
 * The shared skeleton for §5.U AUXILIARY SECONDARY sessions (reviewer / plan-critic / merge-resolver / mirror): spin
 * up a bounded, sandboxed synthetic session against the primary task's DELIVERED tree, run the runner's turns under a
 * deadline, and ALWAYS tear the synthetic session + workspace + per-task state down. Extracted verbatim from the
 * inline setup/`runBoundedTurn`/teardown that each runner repeated (first lifted from the second-opinion review
 * runner). The runner supplies only its own `drive` (start the session, capture the verdict, nudge) via the closure.
 */
export function createSecondarySessionHarness(deps: SecondarySessionHarnessDeps): SecondarySessionHarness {
	async function runBracketed<T>(
		config: SecondarySessionConfig,
		drive: (ctx: SecondarySessionContext) => Promise<T>,
	): Promise<T | null> {
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			return null;
		}
		await sandboxManager.assertAvailable();
		// Review runs against the DELIVERED tree (resolve the result-branch commit); the other runners check out the
		// caller-supplied ref directly (no primaryTaskId).
		const resultCommit = config.primaryTaskId
			? await resolveTaskResultBranchCommit({
					repoPath: config.projectRepoPath,
					taskId: config.primaryTaskId,
				}).catch(() => null)
			: null;
		const effectiveBaseRef = resultCommit ?? config.baseRef;
		const workspace = await sandboxManager.prepareWorkspace({
			taskId: config.syntheticTaskId,
			projectRepoPath: config.projectRepoPath,
			baseRef: effectiveBaseRef ?? null,
			// Auxiliary seam — NEVER wait forever on a slot (run19 froze here for 15+ min after a leaked slot).
			// A rejection propagates to the runner's catch ⇒ session "skipped" ⇒ fail-closed hold, run alive.
			maxQueueWaitMs: 180_000,
		});
		deps.setSandbox(config.syntheticTaskId, config.projectRepoPath, effectiveBaseRef?.trim() || "HEAD");
		const deadlineMs = Date.now() + (config.timeoutMs ?? config.defaultTimeoutMs);
		const recordSessionError = (error: unknown): void => {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `${config.errorLabel} failed: ${error instanceof Error ? error.message : String(error)}`,
				taskId: config.syntheticTaskId,
				workspacePath: config.projectRepoPath,
				createdAt: Date.now(),
			});
		};
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<SecondaryTurnOutcome> => {
			const remainingMs = deadlineMs - Date.now();
			if (remainingMs <= 0) {
				return "timeout";
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<"timeout">((resolve) => {
				timer = setTimeout(() => resolve("timeout"), remainingMs);
			});
			const outcome = await Promise.race([
				turn.then(
					() => "settled" as const,
					(error) => {
						recordSessionError(error);
						return "error" as const;
					},
				),
				timeout,
			]);
			if (timer) {
				clearTimeout(timer);
			}
			return outcome;
		};
		try {
			return await drive({ workspace, deadlineMs, runBoundedTurn });
		} finally {
			await deps.clearTaskSessions(config.syntheticTaskId).catch(() => undefined);
			await sandboxManager.disposeWorkspace(config.syntheticTaskId).catch(() => undefined);
			deps.forgetSyntheticState(config.syntheticTaskId);
		}
	}

	return { runBracketed };
}
