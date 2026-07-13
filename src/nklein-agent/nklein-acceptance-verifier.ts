import type { RuntimeTaskAcceptanceResult } from "../core/api-contract";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { runNKleinAcceptanceGateInSandbox } from "./nklein-acceptance-gate";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import type { NKleinPauseController } from "./nklein-pause-controller";

export interface VerifyTaskAcceptanceInput {
	taskId: string;
	projectRepoPath: string;
	baseRef: string;
	taskPrompt: string;
	timeoutMs?: number;
	resultBranchTaskId?: string;
	resultCommit?: string;
	useBaseTree?: boolean;
}

/**
 * Service touchpoints for the acceptance verifier. The sandbox manager may be absent (unisolated test runtime);
 * the pause controller gates confirmed host actions during the acceptance run.
 */
export interface AcceptanceVerifierDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getPauseController(): NKleinPauseController;
}

export interface AcceptanceVerifier {
	verify(input: VerifyTaskAcceptanceInput): Promise<RuntimeTaskAcceptanceResult>;
}

/**
 * The auxiliary ACCEPTANCE-verification session (first of the §5.U auxiliary-secondary-session runners). A thin
 * orchestrator over the already-extracted `runNKleinAcceptanceGateInSandbox`: it resolves the DELIVERED tree (the
 * task's result-branch commit, not the callers' base ref) and runs the acceptance gate against it in a sandbox.
 * Moved verbatim from InMemoryNKleinTaskSessionService.verifyTaskAcceptanceInSandbox.
 */
export function createAcceptanceVerifier(deps: AcceptanceVerifierDeps): AcceptanceVerifier {
	async function verify(input: VerifyTaskAcceptanceInput): Promise<RuntimeTaskAcceptanceResult> {
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			throw new Error("!Klein acceptance verification requires the configured agent sandbox manager.");
		}
		// Test the DELIVERED tree: acceptance evidence must run against the task's result branch, not the base
		// ref the callers hold (run19 autopsy: base-tree acceptance is false evidence in both directions — a
		// base-green repo rubber-stamps a no-op, a base-red repo fail-holds perfect work). No result branch yet
		// (e.g. empty patch) falls back to the base ref, where the empty-patch hold already governs.
		// §5.AW: when the reviewer preferred the speculative candidate, the DELIVERED tree is the ::spec
		// branch — acceptance evidence must run against what actually ships.
		const resultCommit = input.useBaseTree
			? null
			: (input.resultCommit?.trim() ?? "") ||
				(await resolveTaskResultBranchCommit({
					repoPath: input.projectRepoPath,
					taskId: input.resultBranchTaskId ?? input.taskId,
				}).catch(() => null));
		return await runNKleinAcceptanceGateInSandbox({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: resultCommit ?? input.baseRef,
			taskPrompt: input.taskPrompt,
			timeoutMs: input.timeoutMs,
			sandboxManager,
			pauseController: deps.getPauseController(),
		});
	}

	return { verify };
}
