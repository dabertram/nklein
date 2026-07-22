import { createHash } from "node:crypto";
import { type AgentCommunitySkillEvent, buildCommunitySkillEvent } from "../core/agent-attempt-ledger";
import type { RuntimeCommunitySkillImportReviewResponse } from "../core/community-skill-import-api-contract";
import type {
	CommunitySkillExecutionReview,
	CommunitySkillSessionAdmission,
} from "./community-skill-execution-service";
import type { VerifiedCommunitySkillSnapshot } from "./community-skill-snapshot";

export interface CommunitySkillLedgerContext {
	workspacePathHash: string;
	workflowId: string;
	taskId: string;
}

const GLOBAL_IMPORT_CONTEXT: CommunitySkillLedgerContext = {
	workspacePathHash: createHash("sha256").update("community-skills-global").digest("hex").slice(0, 16),
	workflowId: "community-skill-import",
	taskId: "community-skill-import",
};

export function buildCommunitySkillImportLedgerEvent(input: {
	review: RuntimeCommunitySkillImportReviewResponse;
	stage: "scan" | "import";
	snapshotId?: string | null;
	recordedAt?: number;
}): AgentCommunitySkillEvent {
	const review = input.review;
	return buildCommunitySkillEvent({
		...GLOBAL_IMPORT_CONTEXT,
		workflowId: `community-skill-import:${review.skillId}`,
		taskId: review.skillId,
		stage: input.stage,
		skillId: review.skillId,
		snapshotId: input.snapshotId ?? null,
		contentHash: review.contentHash,
		version: review.version,
		source: review.sourceUrl,
		scanVerdicts: {
			bundle: review.bundledManifest.verdict,
			executable: review.executableScreen.verdict,
			injection: review.injectionScreen.verdict,
		},
		importVerdict: review.decision.decision,
		grant: {
			grantedTools: review.capabilityGrant.granted,
			effectiveTools: review.capabilityGrant.effectiveTools,
			deniedTools: review.capabilityGrant.denied.map((denial) => denial.tool),
			networkPolicy: null,
			credentialMode: null,
		},
		...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }),
	});
}

function executionGrant(review: Pick<CommunitySkillExecutionReview, "containment">) {
	return {
		grantedTools: review.containment.capabilityGrant.granted,
		effectiveTools: review.containment.effectiveTools,
		deniedTools: [
			...review.containment.capabilityGrant.denied.map((denial) => denial.tool),
			...review.containment.deniedByContainment.map((denial) => denial.tool),
		],
		networkPolicy: review.containment.networkPolicy,
		credentialMode: review.containment.credentialMode,
	};
}

export function buildCommunitySkillExecutionLedgerEvent(input: {
	review: CommunitySkillExecutionReview;
	snapshot: VerifiedCommunitySkillSnapshot;
	stage: "execution_review" | "execution_approval";
	activationId?: string | null;
	context: CommunitySkillLedgerContext;
	recordedAt?: number;
}): AgentCommunitySkillEvent {
	const review = input.review;
	const importedDecision = input.snapshot.metadata.decision;
	const importVerdict =
		importedDecision && typeof importedDecision === "object"
			? (importedDecision as Record<string, unknown>).decision
			: null;
	return buildCommunitySkillEvent({
		...input.context,
		role: review.role,
		stage: input.stage,
		skillId: review.skillId,
		snapshotId: review.snapshotId,
		activationId: input.activationId ?? null,
		sessionId: review.sessionId,
		contentHash: review.contentHash,
		version: review.version,
		source: input.snapshot.metadata.sourceUrl,
		scanVerdicts: {
			bundle: input.snapshot.loaded.bundledManifest.verdict,
			executable: input.snapshot.loaded.executableScreen.verdict,
			injection: input.snapshot.loaded.injectionScreen.verdict,
		},
		importVerdict:
			importVerdict === "allow" || importVerdict === "review" || importVerdict === "reject"
				? importVerdict
				: "unknown",
		executionVerdict: review.containment.decision,
		grant: executionGrant(review),
		approvals: review.containment.approvedExecutableFiles,
		...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }),
	});
}

export function buildCommunitySkillAdmissionLedgerEvents(input: {
	admission: CommunitySkillSessionAdmission;
	context: CommunitySkillLedgerContext;
	role: string;
	recordedAt?: number;
}): AgentCommunitySkillEvent[] {
	return input.admission.skills.map((skill) =>
		buildCommunitySkillEvent({
			...input.context,
			role: input.role,
			stage: "admission",
			skillId: skill.skillId,
			snapshotId: skill.snapshotId,
			activationId: skill.activationId,
			sessionId: input.context.taskId,
			contentHash: skill.contentHash,
			version: skill.version,
			source: skill.source,
			scanVerdicts: skill.scanVerdicts,
			importVerdict: skill.importVerdict,
			executionVerdict: skill.containment.decision,
			grant: executionGrant({ containment: skill.containment }),
			approvals: skill.containment.approvedExecutableFiles,
			evidenceRef: `policy:${skill.policyHash}`,
			...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }),
		}),
	);
}
