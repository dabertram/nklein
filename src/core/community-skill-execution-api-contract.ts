import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const snapshotIdSchema = z.string().regex(/^[a-f0-9]{32}\/[a-f0-9]{64}$/u);
const sessionIdSchema = z.string().trim().min(1).max(255);
const roleSchema = z.enum(["architect", "worker", "reviewer"]);
const executableFileSchema = z.object({ path: z.string().min(1), sha256: sha256Schema }).strict();
const executableApprovalSchema = executableFileSchema.extend({ confirmation: z.literal(true) }).strict();

export const runtimeCommunitySkillExecutionReviewRequestSchema = z
	.object({
		snapshotId: snapshotIdSchema,
		sessionId: sessionIdSchema,
		role: roleSchema,
		requestedExecutablePaths: z.array(z.string().min(1)).max(256).optional(),
		executableApprovals: z.array(executableApprovalSchema).max(256).optional(),
	})
	.strict();
export type RuntimeCommunitySkillExecutionReviewRequest = z.infer<
	typeof runtimeCommunitySkillExecutionReviewRequestSchema
>;

const capabilityGrantSchema = z
	.object({
		granted: z.array(z.string()),
		denied: z.array(
			z.object({ tool: z.string(), reason: z.literal("not_in_allowed_set"), detail: z.string() }).strict(),
		),
		effectiveTools: z.array(z.string()),
		posture: z.enum(["undeclared", "empty_declaration", "fully_granted", "partially_granted", "fully_denied"]),
		reason: z.string(),
	})
	.strict();

const containmentSchema = z
	.object({
		decision: z.enum(["allow", "approval-required", "deny"]),
		reason: z.string(),
		capabilityGrant: capabilityGrantSchema,
		effectiveTools: z.array(z.string()),
		deniedByContainment: z.array(
			z
				.object({
					tool: z.string(),
					reason: z.enum([
						"host_scope_forbidden",
						"secret_access_forbidden",
						"network_unavailable",
						"rule_of_two_sensitive_session",
					]),
					detail: z.string(),
				})
				.strict(),
		),
		networkPolicy: z.enum(["none", "allowlist"]),
		credentialMode: z.enum(["none", "task-scoped-egress-only"]),
		approvedExecutableFiles: z.array(executableFileSchema),
		disabledExecutableFiles: z.array(executableFileSchema),
		pendingExecutableApprovals: z.array(executableFileSchema),
		ruleOfTwo: z
			.object({
				untrustedInput: z.literal(true),
				sensitiveAccess: z.boolean(),
				externalOrStatefulEffects: z.boolean(),
				propertyCount: z.number().int().min(1).max(3),
				satisfied: z.boolean(),
				configuration: z.enum(["A", "AB", "AC"]),
				reason: z.string(),
			})
			.strict(),
		reasons: z.array(z.string()),
	})
	.strict();

export const runtimeCommunitySkillExecutionReviewResponseSchema = z
	.object({
		snapshotId: snapshotIdSchema,
		skillId: z.string(),
		contentHash: sha256Schema,
		version: z.string().nullable(),
		sessionId: sessionIdSchema,
		role: roleSchema,
		policyHash: sha256Schema,
		containment: containmentSchema,
		promptEligible: z.boolean(),
		active: z.literal(false),
	})
	.strict();
export type RuntimeCommunitySkillExecutionReviewResponse = z.infer<
	typeof runtimeCommunitySkillExecutionReviewResponseSchema
>;

export const runtimeCommunitySkillExecutionApproveRequestSchema = runtimeCommunitySkillExecutionReviewRequestSchema
	.extend({ expectedContentHash: sha256Schema, expectedPolicyHash: sha256Schema, confirmation: z.literal(true) })
	.strict();
export type RuntimeCommunitySkillExecutionApproveRequest = z.infer<
	typeof runtimeCommunitySkillExecutionApproveRequestSchema
>;

export const runtimeCommunitySkillExecutionApproveResponseSchema = runtimeCommunitySkillExecutionReviewResponseSchema
	.omit({ active: true })
	.extend({ activationId: sha256Schema, approvedAt: z.number().int().nonnegative(), active: z.literal(true) })
	.strict();
export type RuntimeCommunitySkillExecutionApproveResponse = z.infer<
	typeof runtimeCommunitySkillExecutionApproveResponseSchema
>;
