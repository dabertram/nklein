import type { RuntimeTaskAcceptanceResult } from "../core/api-contract";
import { isTruthyEnv } from "../core/env-flag";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { runNKleinAcceptanceGateInSandbox } from "./nklein-acceptance-gate";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import type { NKleinPauseController } from "./nklein-pause-controller";
import { verifyPropertiesInSandbox } from "./nklein-property-acceptance-verifier";
import type { PropertyBindingModelCaller } from "./nklein-property-binding-model-caller";
import { forgetPropertyCheckEvidence, storePropertyCheckEvidence } from "./nklein-property-evidence-registry";

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
	getPropertyBindingModelCaller?(taskId: string): Promise<PropertyBindingModelCaller | null>;
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
		const acceptance = await runNKleinAcceptanceGateInSandbox({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: resultCommit ?? input.baseRef,
			taskPrompt: input.taskPrompt,
			timeoutMs: input.timeoutMs,
			sandboxManager,
			pauseController: deps.getPauseController(),
		});
		if (input.useBaseTree) {
			forgetPropertyCheckEvidence(input.taskId);
			return acceptance;
		}
		// Property evidence can strengthen a successful ordinary acceptance run, but it can never promote a missing,
		// inconclusive, or failed primary harness into a pass.
		if (!isTruthyEnv(process.env.NKLEIN_PROPERTY_GATE) || acceptance.passed !== true) {
			forgetPropertyCheckEvidence(input.taskId);
			return acceptance;
		}
		const propertyStartedAt = Date.now();
		const property = await (async () => {
			try {
				return await verifyPropertiesInSandbox({
					taskId: input.taskId,
					projectRepoPath: input.projectRepoPath,
					baseRef: input.baseRef,
					taskPrompt: input.taskPrompt,
					resultCommit,
					timeoutMs: input.timeoutMs,
					sandboxManager,
					bindProperties: await deps.getPropertyBindingModelCaller?.(input.taskId),
				});
			} catch (error) {
				return {
					outcome: "unavailable" as const,
					reason: error instanceof Error ? error.message : String(error),
					output: "",
					invariantCount: 0,
				};
			}
		})();
		storePropertyCheckEvidence(input.taskId, property);
		try {
			// N11 registration (2026-08-05): the gate's decision, recorded either way — the lane/audit contract.
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Property gate ${property.outcome} for ${input.taskId} (${property.invariantCount} invariant(s)): ${property.reason}`,
				taskId: input.taskId,
				metadata: { category: "property_gate", outcome: property.outcome },
			});
		} catch {
			// Telemetry must never affect acceptance.
		}
		const propertyOutput = `\n\n[property checks: ${property.outcome}] ${property.reason}${property.output ? `\n${property.output}` : ""}`;
		const durationMs = acceptance.durationMs + Math.max(0, Date.now() - propertyStartedAt);
		if (property.outcome === "unavailable") {
			return { ...acceptance, output: `${acceptance.output}${propertyOutput}`, durationMs };
		}
		if (property.outcome === "fail") {
			return {
				...acceptance,
				present: true,
				passed: false,
				exitCode: 1,
				output: `${acceptance.output}${propertyOutput}`,
				durationMs,
				failureCategory: "test_failure",
				failureHint: `A spec-derived property was falsified. ${property.reason}`,
			};
		}
		return {
			...acceptance,
			present: true,
			passed: true,
			exitCode: acceptance.exitCode ?? 0,
			output: `${acceptance.output}${propertyOutput}`,
			durationMs,
		};
	}

	return { verify };
}
