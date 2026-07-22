import { type AgentCommunitySkillEvent, buildCommunitySkillEvent } from "../core/agent-attempt-ledger";
import { appendAgentLedgerEvent, readAgentLedger } from "../state/agent-attempt-ledger-store";
import { hashWorkspacePathForLedger } from "./nklein-ledger-attempt";

/**
 * F4.27 acceptance-evidence bridge. A pass/fail is a helped/hurt SIGNAL, not causal proof that the skill alone caused
 * the result; `effectivenessBasis="acceptance"` keeps that distinction queryable. Best-effort by contract.
 */
export async function recordCommunitySkillEffectivenessForTask(input: {
	taskId: string;
	workspacePath: string | null;
	passed: boolean;
	recordedAt?: number;
	rootDir?: string;
}): Promise<void> {
	try {
		const workspacePathHash = hashWorkspacePathForLedger(input.workspacePath);
		const events = await readAgentLedger({ workspacePathHash, rootDir: input.rootDir });
		const latestAdmissionByActivation = new Map<string, AgentCommunitySkillEvent>();
		for (const event of events) {
			if (
				event.kind === "community_skill" &&
				event.stage === "admission" &&
				event.taskId === input.taskId &&
				event.activationId
			) {
				latestAdmissionByActivation.set(event.activationId, event);
			}
		}
		const recordedAt = input.recordedAt ?? Date.now();
		for (const admission of latestAdmissionByActivation.values()) {
			await appendAgentLedgerEvent(
				buildCommunitySkillEvent({
					workflowId: admission.workflowId,
					taskId: admission.taskId,
					workspacePathHash,
					role: admission.role,
					stage: "effectiveness",
					skillId: admission.skillId,
					snapshotId: admission.snapshotId,
					activationId: admission.activationId,
					sessionId: admission.sessionId,
					contentHash: admission.contentHash,
					version: admission.version,
					source: admission.source,
					scanVerdicts: admission.scanVerdicts,
					importVerdict: admission.importVerdict,
					executionVerdict: admission.executionVerdict,
					grant: admission.grant,
					approvals: admission.approvals,
					effectivenessSignal: input.passed ? "helped" : "hurt",
					effectivenessBasis: "acceptance",
					evidenceRef: `acceptance:${input.taskId}:${input.passed ? "pass" : "fail"}:${recordedAt}`,
					recordedAt,
				}),
				{ rootDir: input.rootDir },
			);
		}
	} catch {
		// Skill telemetry must never disturb acceptance or review delivery.
	}
}
