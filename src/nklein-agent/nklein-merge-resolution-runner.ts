import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import { createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import { buildMergeResolutionSeedPrompt, type NKleinMergeResolutionResult } from "./nklein-merge-resolution-tool";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import { createSessionId } from "./nklein-session-state";

/** Merge sessions are bounded to the same overall budget as a review session and get the same nudge count. */
const DEFAULT_MERGE_RESOLUTION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MERGE_RESOLUTION_NUDGES = 2;
/** §5.AK Phase B: conflicted files this large (or binary) are beyond a bounded text-edit session — fall back to abort. */
const MAX_MERGE_RESOLUTION_FILE_BYTES = 1024 * 1024;
const MERGE_RESOLUTION_NUDGE_PROMPT =
	"You ended your turn without calling `submit_merge_resolution`, so no resolution was recorded. Your outcome is delivered ONLY by that tool. Finish resolving the conflict markers, then call `submit_merge_resolution` now: `resolved`, or `cannot_resolve` with the concrete blocker. Do not answer in prose.";

/** One conflicted file's agent-resolved contents, captured from the `::merge` sandbox (§5.AK Phase B). */
export interface NKleinMergeResolutionResolvedFile {
	path: string;
	content: string;
}

/**
 * Outcome of a `::merge` resolution session (§5.AK Phase B). `clean` = the sandbox reproduction merged with no
 * conflict (no model turn was spent); `resolved` = the agent edited every marker away and the resolved contents
 * of ONLY the conflicted files were captured for host-side application; `cannot_resolve` carries the agent's
 * concrete blocker. Callers treat anything but `resolved` (and a null session yield) as "abort and surface the
 * conflict exactly as before" — the agent is strictly additive.
 */
export type NKleinMergeResolutionSessionOutcome =
	| { outcome: "clean" }
	| { outcome: "resolved"; resolvedFiles: NKleinMergeResolutionResolvedFile[] }
	| { outcome: "cannot_resolve"; reason: string };

/** Service touchpoints. `forgetSyntheticState` bundles the shared teardown-forgets; `pickEscalationModel` prefers a
 * lineage-diverse (typically stronger) model for the high-stakes merge. */
export interface MergeResolutionRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null | undefined;
	pickEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null>;
	getPauseController(): NKleinPauseController;
	setSandbox(taskId: string, projectRepoPath: string, baseRef: string): void;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string): Promise<unknown>;
	clearTaskSessions(taskId: string): Promise<unknown>;
	forgetSyntheticState(taskId: string): void;
}

export interface MergeResolutionRunner {
	runMergeResolutionSession(input: {
		taskId: string;
		projectRepoPath: string;
		mainRef: string;
		resultCommit: string;
		conflictedPaths: string[];
		timeoutMs?: number;
	}): Promise<NKleinMergeResolutionSessionOutcome | null>;
}

/**
 * §5.AK Phase B: one bounded `::merge` session that resolves a result-branch merge conflict inside a SANDBOX
 * reproduction — the host repo never holds the agent's dirty merge state. Extracted verbatim from
 * InMemoryNKleinTaskSessionService. The conflict is reproduced in the sandbox (merge the delivered result commit
 * at the project main ref) BEFORE the model turn, verified against the host conflict set, then the agent's
 * resolution is trust-but-verified (leftover markers, symlink/binary/size guards, TOCTOU hard-stop) before ONLY the
 * conflicted files' contents are captured back for host application.
 */
export function createMergeResolutionRunner(deps: MergeResolutionRunnerDeps): MergeResolutionRunner {
	async function runMergeResolutionSession(input: {
		taskId: string;
		projectRepoPath: string;
		mainRef: string;
		resultCommit: string;
		conflictedPaths: string[];
		timeoutMs?: number;
	}): Promise<NKleinMergeResolutionSessionOutcome | null> {
		const manager = deps.getAgentSandboxManager();
		if (!manager) {
			return null;
		}
		const workerLaunch = deps.getLaunchConfig(input.taskId) ?? null;
		// High-stakes merge: prefer the lineage-diverse (typically stronger) escalation pick when one is loaded;
		// the task's own launch config is the fallback. With neither there is no way to run a session at all.
		const diverse = await deps.pickEscalationModel(input.taskId).catch(() => null);
		const providerId = (diverse?.providerId ?? workerLaunch?.providerId ?? "").trim();
		const modelId = (diverse?.modelId ?? workerLaunch?.modelId ?? "").trim();
		if (!providerId || !modelId) {
			return null;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId,
			modelId,
			workspaceRoot: input.projectRepoPath,
			// EXPLICITLY drop the worker card's write-scope guards: conflicted paths routinely fall outside the
			// card's declared filesLikelyTouched (bash side effects: lockfiles, codegen), and an inherited
			// per-file line cap can forbid writing a large resolved file — either would burn the whole bounded
			// session on hard-blocked edits. The merge agent's real boundary is the conflicted-path capture:
			// only those files ever reach the host.
			filesLikelyTouched: null,
			maxAgentWritableFileLines: null,
		};
		const mergeTaskId = `${input.taskId}::merge`;
		await manager.assertAvailable();
		const workspace = await manager.prepareWorkspace({
			taskId: mergeTaskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: input.mainRef?.trim() || null,
			// Auxiliary seam — NEVER wait forever on a slot (run19 froze here for 15+ min after a leaked slot).
			// A rejection propagates to the delivery caller's catch ⇒ null ⇒ abort-and-surface, run alive.
			maxQueueWaitMs: 180_000,
		});
		deps.setSandbox(mergeTaskId, input.projectRepoPath, input.mainRef?.trim() || "HEAD");
		let verdict: NKleinMergeResolutionResult | null = null;
		const deadlineMs = Date.now() + (input.timeoutMs ?? DEFAULT_MERGE_RESOLUTION_TIMEOUT_MS);
		const recordMergeSessionError = (message: string): void => {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Merge-resolution session failed: ${message}`,
				taskId: mergeTaskId,
				workspacePath: input.projectRepoPath,
				createdAt: Date.now(),
			});
		};
		// Awaits one merge-agent turn, bounded by the remaining overall budget (an SDK turn can hang); turn errors
		// are recorded, not thrown, so they fall through to a null verdict (the caller then aborts-and-surfaces).
		// Returns whether the turn actually SETTLED (resolved/rejected) — false means the deadline fired with the
		// turn STILL RUNNING in the background, so the sandbox tree may keep changing under later execs (TOCTOU).
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<boolean> => {
			let turnSettled = false;
			const settleTracked = turn.then(
				() => {
					turnSettled = true;
				},
				(error) => {
					turnSettled = true;
					recordMergeSessionError(error instanceof Error ? error.message : String(error));
				},
			);
			const remainingMs = deadlineMs - Date.now();
			if (remainingMs <= 0) {
				return turnSettled;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, remainingMs);
			});
			await Promise.race([settleTracked, timeout]);
			if (timer) {
				clearTimeout(timer);
			}
			return turnSettled;
		};
		// TOCTOU guard (fix 5): true only while every bounded turn settled BEFORE its deadline. When false, a
		// live agent turn may still be writing into the sandbox and the scan/commit/capture sequence below must
		// hard-stop the session first.
		let lastTurnSettled = true;
		try {
			// REPRODUCE the conflict inside the sandbox: merge the delivered result commit onto the main ref. The
			// result branch ref is host-side only, but the sandbox clone copies the host object store (/repos
			// mount), so the raw commit sha resolves. Non-zero exit leaves the conflict markers in the working
			// tree — exactly the state the agent must fix. A CLEAN merge is instant success without a model turn.
			// Explicit generous timeout: the 30s exec default can kill the docker CLIENT mid-merge on a large
			// merge / slow machine (exitCode null, merge still running in-container) — a poisoned reproduction.
			const reproduce = await manager.exec(
				mergeTaskId,
				["git", "-C", workspace.workdir, "merge", "--no-ff", "--no-edit", input.resultCommit],
				{ timeoutMs: 600_000 },
			);
			if (reproduce.exitCode === 0) {
				return { outcome: "clean" };
			}
			if (reproduce.exitCode === null) {
				recordMergeSessionError(
					"sandbox merge reproduction did not finish (exec exit null) — cannot trust the sandbox state",
				);
				return null;
			}
			// VERIFY the reproduction matches the host conflict EXACTLY: a merge can fail differently in the
			// sandbox (missing host merge drivers, git-version drift, unmergeable sha), and every downstream
			// guard only inspects the host-provided conflictedPaths — a divergent reproduction could otherwise
			// let the agent "resolve" a tree that never held the host's conflict and commit a semantically wrong
			// merge. Require the sandbox unmerged set to equal input.conflictedPaths (order-insensitive; empty
			// means no real mid-merge conflict). Any mismatch is fail-safe null → abort-and-surface.
			const sandboxUnmerged = await manager.exec(mergeTaskId, [
				"git",
				"-C",
				workspace.workdir,
				"diff",
				"--name-only",
				"--diff-filter=U",
				"-z",
			]);
			// Mirrors the host-side parseNullSeparatedPaths (trim each entry, drop empties) so the two sets are
			// byte-comparable.
			const sandboxConflictedPaths =
				sandboxUnmerged.exitCode === 0
					? sandboxUnmerged.stdout
							.split("\0")
							.map((path) => path.trim())
							.filter((path) => path.length > 0)
					: null;
			const hostSet = new Set(input.conflictedPaths);
			const sandboxSet = new Set(sandboxConflictedPaths ?? []);
			const conflictSetsMatch =
				sandboxConflictedPaths !== null &&
				sandboxSet.size > 0 &&
				sandboxSet.size === hostSet.size &&
				[...sandboxSet].every((path) => hostSet.has(path));
			if (!conflictSetsMatch) {
				recordMergeSessionError(
					`sandbox merge reproduction diverged from the host conflict — host unmerged: [${[...hostSet].join(", ")}]; sandbox unmerged: ${
						sandboxConflictedPaths === null
							? `(unreadable — git diff exit ${sandboxUnmerged.exitCode ?? "null"})`
							: `[${[...sandboxSet].join(", ")}]`
					}`,
				);
				return null;
			}
			// Binary or oversized conflicted files are beyond a bounded text-edit session — don't spend a model turn.
			for (const path of input.conflictedPaths) {
				const size = await manager.exec(mergeTaskId, ["wc", "-c", "--", path]);
				const bytes = Number.parseInt(size.stdout.trim().split(/\s+/u)[0] ?? "", 10);
				if (size.exitCode !== 0 || !Number.isFinite(bytes) || bytes > MAX_MERGE_RESOLUTION_FILE_BYTES) {
					return {
						outcome: "cannot_resolve",
						reason:
							size.exitCode === 0 && Number.isFinite(bytes)
								? `Conflicted file "${path}" is ${bytes} bytes — over the ${MAX_MERGE_RESOLUTION_FILE_BYTES}-byte cap for agent merge resolution.`
								: `Conflicted file "${path}" could not be measured in the sandbox reproduction.`,
					};
				}
				// GNU grep -I never matches binary files; a conflicted TEXT file always has lines here (the merge
				// machinery just wrote markers into it), so the match-anything empty pattern hits. Exit 0 = text.
				const textProbe = await manager.exec(mergeTaskId, ["grep", "-Iq", "", "--", path]);
				if (textProbe.exitCode !== 0) {
					return {
						outcome: "cannot_resolve",
						reason: `Conflicted file "${path}" looks binary; agent merge resolution only handles text files.`,
					};
				}
			}
			// First turn: seed prompt + the submit_merge_resolution tool, file/bash tools routed into the sandbox.
			lastTurnSettled = await runBoundedTurn(
				deps.startRuntimeSession({
					taskId: mergeTaskId,
					cwd: workspace.workdir,
					workspaceRoot: input.projectRepoPath,
					prompt: buildMergeResolutionSeedPrompt({
						taskId: input.taskId,
						conflictedPaths: input.conflictedPaths,
					}),
					launchConfig,
					contextScope: "minimal",
					onMergeResolutionSubmitted: (result) => {
						verdict = result;
					},
					toolExecutors: createAgentSandboxToolExecutors(manager, mergeTaskId, {
						pauseController: deps.getPauseController(),
					}),
					extraTools: createAgentSandboxExtraTools(manager, mergeTaskId, {
						sessionId: createSessionId(mergeTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					}),
				}),
			);
			for (
				let nudge = 0;
				verdict === null && nudge < MAX_MERGE_RESOLUTION_NUDGES && Date.now() < deadlineMs;
				nudge += 1
			) {
				lastTurnSettled = await runBoundedTurn(
					deps.sendTaskSessionInput(mergeTaskId, MERGE_RESOLUTION_NUDGE_PROMPT),
				);
			}
			// Widen past TS's closure-assignment blind spot: `verdict` is only ever written inside the
			// onMergeResolutionSubmitted callback, so control-flow analysis still sees the `null` initializer here.
			const submission = verdict as NKleinMergeResolutionResult | null;
			if (!submission) {
				return null;
			}
			if (submission.outcome === "cannot_resolve") {
				return { outcome: "cannot_resolve", reason: submission.reason ?? submission.summary };
			}
			// TOCTOU guard (fix 5): if the deadline fired while a turn was STILL RUNNING, the agent may keep
			// issuing sandbox writes concurrently with the scan/commit/capture below — a file rewritten between
			// the marker scan and its cat could be captured marker-free but semantically half-edited. Hard-stop
			// the session (clearTaskSessions aborts the live session host) BEFORE touching the sandbox tree.
			if (!lastTurnSettled) {
				await deps.clearTaskSessions(mergeTaskId).catch(() => undefined);
			}
			// Trust but verify the "resolved" claim: any leftover conflict marker in a conflicted file is a hard
			// fail. grep exit codes: 0 = markers found (unresolved), 1 = none (good), 2+ = probe failure (fail safe).
			const markerScan = await manager.exec(mergeTaskId, [
				"grep",
				"-l",
				"-E",
				"^(<<<<<<<|>>>>>>>)",
				"--",
				...input.conflictedPaths,
			]);
			if (markerScan.exitCode !== 1) {
				recordMergeSessionError(
					markerScan.exitCode === 0
						? `agent reported "resolved" but conflict markers remain in: ${markerScan.stdout.trim()}`
						: `leftover-marker verification could not run (grep exit ${markerScan.exitCode ?? "null"})`,
				);
				return null;
			}
			// Complete the merge commit in the sandbox (validates the merge state is committable; the sandbox has
			// no git identity, so pass one inline). The commit does not change the working tree we capture below.
			// Agents habitually finish a mid-merge fix with their OWN `git commit` (git's conflict hints tell them
			// to) — that consumes MERGE_HEAD, and a follow-up commit would fail with "nothing to commit" and throw
			// away a perfectly valid resolution. So: MERGE_HEAD gone + clean worktree = already-committed success;
			// MERGE_HEAD present = commit as usual (non-zero → fail-safe null).
			const sandboxMergeHead = await manager.exec(mergeTaskId, [
				"git",
				"-C",
				workspace.workdir,
				"rev-parse",
				"-q",
				"--verify",
				"MERGE_HEAD",
			]);
			if (sandboxMergeHead.exitCode === 0) {
				const commit = await manager.exec(mergeTaskId, [
					"git",
					"-C",
					workspace.workdir,
					"-c",
					"user.name=nklein-merge-agent",
					"-c",
					"user.email=nklein-merge-agent@local.invalid",
					"commit",
					"-am",
					`Merge resolution for ${input.taskId}`,
				]);
				if (commit.exitCode !== 0) {
					recordMergeSessionError(`sandbox merge commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`);
					return null;
				}
			} else {
				const worktreeStatus = await manager.exec(mergeTaskId, [
					"git",
					"-C",
					workspace.workdir,
					"status",
					"--porcelain",
				]);
				if (worktreeStatus.exitCode !== 0 || worktreeStatus.stdout.trim() !== "") {
					recordMergeSessionError(
						`sandbox MERGE_HEAD is gone but the worktree is not clean (status exit ${worktreeStatus.exitCode ?? "null"}) — cannot trust the agent's own commit`,
					);
					return null;
				}
			}
			// Capture the resolved contents of ONLY the conflicted files back to the host (the sandbox tree is a
			// container volume — there is nothing host-fetchable, so the file contents ARE the deliverable).
			const resolvedFiles: NKleinMergeResolutionResolvedFile[] = [];
			for (const path of input.conflictedPaths) {
				// Symlink guard (mirrors the host-side lstat rule): cat/grep/wc all FOLLOW a sandbox symlink, so a
				// conflicted path that is a symlink would capture the TARGET's content while the host applies it to
				// the link path. `test -L` exit 1 = not a symlink (good); anything else is fail-safe null.
				const symlinkProbe = await manager.exec(mergeTaskId, ["test", "-L", path]);
				if (symlinkProbe.exitCode !== 1) {
					recordMergeSessionError(
						symlinkProbe.exitCode === 0
							? `conflicted path "${path}" is a symlink in the sandbox — capture would follow the link target`
							: `symlink probe for "${path}" could not run (test exit ${symlinkProbe.exitCode ?? "null"})`,
					);
					return null;
				}
				const content = await manager.exec(mergeTaskId, ["cat", "--", path]);
				if (content.exitCode !== 0) {
					recordMergeSessionError(`could not capture resolved file "${path}": ${content.stderr.trim()}`);
					return null;
				}
				resolvedFiles.push({ path, content: content.stdout });
			}
			return { outcome: "resolved", resolvedFiles };
		} finally {
			await deps.clearTaskSessions(mergeTaskId).catch(() => undefined);
			await manager.disposeWorkspace(mergeTaskId).catch(() => undefined);
			deps.forgetSyntheticState(mergeTaskId);
		}
	}

	return { runMergeResolutionSession };
}
