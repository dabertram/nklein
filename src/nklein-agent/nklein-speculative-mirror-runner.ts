import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { applyTaskPatchToResultBranch, type TaskResultBranch } from "../workspace/task-result-branches";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import { createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import { createSessionId, type NKleinTaskSessionEntry } from "./nklein-session-state";

const DEFAULT_SPECULATIVE_MIRROR_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Service touchpoints for the speculative-mirror runner. `forgetSyntheticState` bundles the shared teardown-forgets
 * (launch config / provider id / model endpoint / context-budget inputs / sandbox state); the runner additionally
 * clears its own cancel flag.
 */
export interface SpeculativeMirrorRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null | undefined;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null | undefined;
	getPauseController(): NKleinPauseController;
	setSandbox(taskId: string, projectRepoPath: string, baseRef: string): void;
	setResultBranch(taskId: string, branch: TaskResultBranch): void;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	cancelTaskTurn(taskId: string): Promise<unknown>;
	clearTaskSessions(taskId: string): Promise<unknown>;
	forgetSyntheticState(taskId: string): void;
}

export interface SpeculativeMirrorRunner {
	runSpeculativeMirrorSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		prompt: string;
		mirror: { providerId: string; modelId: string };
		timeoutMs?: number;
	}): Promise<boolean>;
	cancelSpeculativeMirror(taskId: string): Promise<void>;
}

/**
 * §5.AW opportunistic best-of-N: a SPECULATIVE WORKER session `<taskId>::spec` — a lineage-diverse idle model
 * independently implementing the same card in its own sandbox workspace. Extracted verbatim from
 * InMemoryNKleinTaskSessionService. Mirrors the review runner's bounded shape (auxiliary prepareWorkspace wait,
 * bounded turn, full teardown, never throws) but CAPTURES its work to the `::spec` result branch on completion —
 * that branch's existence at review time arms the A/B arbitration. A mirror canceled via cancelSpeculativeMirror
 * (the primary won the race) never captures.
 */
export function createSpeculativeMirrorRunner(deps: SpeculativeMirrorRunnerDeps): SpeculativeMirrorRunner {
	/** §5.AW specs the arbitration seam canceled — the runner must NOT capture their (partial) work. */
	const canceledSpeculativeMirrorTaskIds = new Set<string>();

	async function cancelSpeculativeMirror(taskId: string): Promise<void> {
		const specTaskId = `${taskId}::spec`;
		canceledSpeculativeMirrorTaskIds.add(specTaskId);
		await deps.cancelTaskTurn(specTaskId).catch(() => undefined);
	}

	async function runSpeculativeMirrorSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		prompt: string;
		mirror: { providerId: string; modelId: string };
		timeoutMs?: number;
	}): Promise<boolean> {
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			return false;
		}
		const specTaskId = `${input.taskId}::spec`;
		// Adversarial finding (2026-07-02): NEVER erase a prior cancel here — a stale tick snapshot can start a
		// mirror after arbitration already canceled it, and erasing the flag would let post-handoff speculative
		// work capture. A lingering flag is harmless (one mirror per card per run).
		if (canceledSpeculativeMirrorTaskIds.has(specTaskId)) {
			return false;
		}
		// The mirror only makes sense while the PRIMARY is still working the card (a stale tick snapshot may
		// fire after a fast handoff — arbitration is already running or done by then).
		if (deps.getTaskEntry(input.taskId)?.summary.state !== "running") {
			return false;
		}
		// No-model-load directive (§5.AB): a mirror must never trigger an LM Studio JIT auto-load. Re-verify the
		// mirror model is STILL resident at start time (the tick's snapshot can be a whole tick stale).
		const workerLaunch = deps.getLaunchConfig(input.taskId) ?? null;
		const residencyBaseUrl = workerLaunch?.baseUrl?.trim() || "http://127.0.0.1:1234/v1";
		const residentIds = await fetchLoadedModelIdsCached(residencyBaseUrl).catch(() => [] as string[]);
		if (residentIds.length > 0 && !residentIds.includes(input.mirror.modelId)) {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Speculative mirror skipped for ${input.taskId}: model ${input.mirror.modelId} is no longer resident (never auto-load for speculation).`,
				taskId: specTaskId,
				workspacePath: input.projectRepoPath,
				metadata: { category: "speculative_mirror_residency_skip", mirrorModelId: input.mirror.modelId },
			});
			return false;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId: input.mirror.providerId,
			modelId: input.mirror.modelId,
			workspaceRoot: input.projectRepoPath,
		};
		await sandboxManager.assertAvailable();
		const baseRef = input.baseRef.trim() || "HEAD";
		const workspace = await sandboxManager.prepareWorkspace({
			taskId: specTaskId,
			projectRepoPath: input.projectRepoPath,
			baseRef,
			// Auxiliary seam — never wait forever on a slot (the run19 lesson); a rejection propagates to the
			// tick's catch and the mirror is simply skipped this round.
			maxQueueWaitMs: 180_000,
		});
		deps.setSandbox(specTaskId, input.projectRepoPath, baseRef);
		const deadlineMs = Date.now() + (input.timeoutMs ?? DEFAULT_SPECULATIVE_MIRROR_TIMEOUT_MS);
		const recordSpecError = (error: unknown): void => {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Speculative mirror session failed: ${error instanceof Error ? error.message : String(error)}`,
				taskId: specTaskId,
				workspacePath: input.projectRepoPath,
				createdAt: Date.now(),
			});
		};
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<"settled" | "timeout"> => {
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
						recordSpecError(error);
						return "settled" as const;
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
			// Cancel raced the sandbox prep (the primary handed off while this workspace queued) — stop before
			// spending a model turn on a lost race.
			if (canceledSpeculativeMirrorTaskIds.has(specTaskId)) {
				return false;
			}
			const turnOutcome = await runBoundedTurn(
				deps.startRuntimeSession({
					taskId: specTaskId,
					cwd: workspace.workdir,
					workspaceRoot: input.projectRepoPath,
					prompt: input.prompt,
					// "smart" = the real-work default (the launch config does not persist the primary's scope choice;
					// the spec is attempting the same card, so it gets the same default treatment).
					contextScope: "smart",
					launchConfig,
					toolExecutors: createAgentSandboxToolExecutors(sandboxManager, specTaskId, {
						pauseController: deps.getPauseController(),
					}),
					extraTools: createAgentSandboxExtraTools(sandboxManager, specTaskId, {
						sessionId: createSessionId(specTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					}),
				}),
			);
			if (canceledSpeculativeMirrorTaskIds.has(specTaskId)) {
				return false; // The primary won the race — partial speculative work is discarded, never captured.
			}
			if (turnOutcome === "timeout") {
				// The turn is (possibly) STILL RUNNING — capturing now would snapshot a mid-write tree as the
				// candidate. A spec that can't finish inside its bound is not a candidate; discard it.
				await deps.cancelTaskTurn(specTaskId).catch(() => undefined);
				return false;
			}
			const patch = await sandboxManager.captureWorkspacePatch(specTaskId, { baseRef });
			const branch = await applyTaskPatchToResultBranch({
				repoPath: input.projectRepoPath,
				taskId: specTaskId,
				baseRef,
				patch,
			});
			if (!branch) {
				return false;
			}
			deps.setResultBranch(specTaskId, branch);
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Speculative mirror captured a candidate: ${branch.branchName} (worker ${workerLaunch?.modelId ?? "unknown"} vs mirror ${input.mirror.modelId}).`,
				taskId: specTaskId,
				workspacePath: input.projectRepoPath,
				metadata: {
					category: "speculative_mirror_captured",
					branchName: branch.branchName,
					headCommit: branch.headCommit,
					mirrorModelId: input.mirror.modelId,
				},
			});
			return true;
		} catch (error) {
			recordSpecError(error);
			return false;
		} finally {
			await deps.clearTaskSessions(specTaskId).catch(() => undefined);
			await sandboxManager.disposeWorkspace(specTaskId).catch(() => undefined);
			deps.forgetSyntheticState(specTaskId);
			canceledSpeculativeMirrorTaskIds.delete(specTaskId);
		}
	}

	return { runSpeculativeMirrorSession, cancelSpeculativeMirror };
}
