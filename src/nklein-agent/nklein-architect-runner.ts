/**
 * F12.62 architect-phase runner — the bounded `::architect` session (§5.U sibling of the explorer runner).
 *
 * When the split decision fires for a write-scoped card on a weak model, ONE bounded read-only session on the
 * SAME model (fresh context window) solves the card in prose and hands back an intent-level implementation brief
 * via `submit_implementation_brief`; the worker (EDITOR) session then starts with the brief prepended, so the
 * weak model never splits its attention between solving and edit-format conformance (the documented aider
 * architect win). Every degraded path resolves to null so the worker ALWAYS starts — a failed architect phase
 * costs one bounded session, never the card.
 */

import { isHomeAgentSessionId } from "../core/home-agent-session";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import { type AgentSandboxManager, createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import { buildArchitectSeedPrompt } from "./nklein-architect-tool";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import type { SecondarySessionHarness } from "./nklein-secondary-session-harness";
import { createSessionId } from "./nklein-session-state";

const ARCHITECT_NUDGE_PROMPT =
	"Submit your implementation brief now by calling the submit_implementation_brief tool with the `brief` field. Do not reply in prose.";

export interface ArchitectRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null;
	getPauseController(): NKleinPauseController;
	getHarness(): SecondarySessionHarness;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string): Promise<unknown>;
	defaultTimeoutMs: number;
	maxNudges: number;
}

export interface ArchitectRunner {
	/**
	 * Run ONE bounded architect session for the card and return the implementation brief, or null on any failure /
	 * synthetic-session recursion (an `::architect` session never spawns another architect). Submission is
	 * tool-only (the proven structured channel); a session that never calls the tool yields null and the worker
	 * proceeds solo, exactly as before the flag.
	 */
	runArchitectPhase(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
	}): Promise<string | null>;
}

export function createArchitectRunner(deps: ArchitectRunnerDeps): ArchitectRunner {
	async function runArchitectPhase(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
	}): Promise<string | null> {
		if (isDerivedTaskSessionId(input.taskId) || isHomeAgentSessionId(input.taskId)) {
			return null;
		}
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			process.stderr.write(`[nklein] Architect phase ${input.taskId}: no sandbox manager — skipping.\n`);
			return null;
		}
		const workerLaunch = deps.getLaunchConfig(input.taskId) ?? null;
		if (!workerLaunch?.providerId || !workerLaunch.modelId) {
			process.stderr.write(
				`[nklein] Architect phase ${input.taskId}: launch config incomplete (provider=${workerLaunch?.providerId ?? "-"} model=${workerLaunch?.modelId ?? "-"}) — skipping.\n`,
			);
			return null;
		}

		// The aider architect pattern allows a DIFFERENT model per phase — NKLEIN_ARCHITECT_MODEL pins the
		// architect (e.g. a fast reasoner) while the editor keeps the card's routed model. Unset ⇒ inherit.
		const architectModelId = process.env.NKLEIN_ARCHITECT_MODEL?.trim() || workerLaunch.modelId;
		process.stderr.write(`[nklein] Architect phase ${input.taskId}: starting ::architect on ${architectModelId}.\n`);
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...workerLaunch,
			modelId: architectModelId,
			workspaceRoot: input.projectRepoPath,
		};
		const architectTaskId = `${input.taskId}::architect`;
		return deps
			.getHarness()
			.runBracketed(
				{
					syntheticTaskId: architectTaskId,
					projectRepoPath: input.projectRepoPath,
					baseRef: input.baseRef,
					defaultTimeoutMs: deps.defaultTimeoutMs,
					errorLabel: "Architect session",
				},
				async ({ workspace, deadlineMs, runBoundedTurn }) => {
					let brief: string | null = null;
					await runBoundedTurn(
						deps.startRuntimeSession({
							taskId: architectTaskId,
							cwd: workspace.workdir,
							workspaceRoot: input.projectRepoPath,
							prompt: buildArchitectSeedPrompt(input.taskPrompt),
							launchConfig,
							contextScope: "minimal",
							onArchitectBriefSubmitted: (submitted) => {
								brief = submitted;
							},
							toolExecutors: createAgentSandboxToolExecutors(sandboxManager, architectTaskId, {
								pauseController: deps.getPauseController(),
							}),
							extraTools: createAgentSandboxExtraTools(sandboxManager, architectTaskId, {
								sessionId: createSessionId(architectTaskId),
								contextWindow: launchConfig.contextWindow ?? undefined,
								maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
							}),
						}),
					);
					for (let nudge = 0; brief === null && nudge < deps.maxNudges && Date.now() < deadlineMs; nudge += 1) {
						await runBoundedTurn(deps.sendTaskSessionInput(architectTaskId, ARCHITECT_NUDGE_PROMPT));
					}
					// Widen past TS's closure-assignment blind spot (the callback writes `brief`).
					return brief as string | null;
				},
			)
			.catch((error) => {
				process.stderr.write(
					`[nklein] Architect phase ${input.taskId}: bracketed run failed (${error instanceof Error ? error.message : String(error)}).\n`,
				);
				return null;
			});
	}

	return { runArchitectPhase };
}
