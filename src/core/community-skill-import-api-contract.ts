import { z } from "zod";

const directorySchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[^/\\]+$/, "Select one immediate directory from the community-skill inbox.");
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const runtimeCommunitySkillImportListResponseSchema = z
	.object({
		inboxPath: z.string(),
		truncated: z.boolean(),
		candidates: z.array(
			z
				.object({
					directory: z.string(),
					selectable: z.boolean(),
					reason: z.string().nullable(),
				})
				.strict(),
		),
	})
	.strict();
export type RuntimeCommunitySkillImportListResponse = z.infer<typeof runtimeCommunitySkillImportListResponseSchema>;

export const runtimeCommunitySkillImportReviewRequestSchema = z
	.object({ directory: directorySchema, sourceUrl: z.string().min(1).max(2_048) })
	.strict();
export type RuntimeCommunitySkillImportReviewRequest = z.infer<typeof runtimeCommunitySkillImportReviewRequestSchema>;

const trustSchema = z
	.object({ trust: z.enum(["trusted", "untrusted"]), origin: z.string(), reason: z.string() })
	.strict();
const fileFindingSchema = z
	.object({ code: z.string(), severity: z.enum(["review", "reject"]), message: z.string() })
	.strict();
const importDecisionSchema = z
	.object({
		decision: z.enum(["allow", "review", "reject"]),
		friction: z.enum(["auto", "confirm", "full-review", "blocked"]),
		pinState: z.enum(["new", "unchanged", "changed"]),
		requiresReconfirm: z.boolean(),
		reasons: z.array(z.string()),
		reason: z.string(),
	})
	.strict();

export const runtimeCommunitySkillImportReviewResponseSchema = z
	.object({
		inboxPath: z.string(),
		directory: z.string(),
		sourceUrl: z.string(),
		sourcePath: z.string(),
		skillId: z.string(),
		contentHash: contentHashSchema,
		version: z.string().nullable(),
		trust: trustSchema,
		manifest: z
			.object({
				name: z.string(),
				description: z.string(),
				license: z.string().optional(),
				version: z.string().optional(),
				compatibility: z.string().optional(),
				allowedTools: z.array(z.string()).optional(),
				extra: z.record(z.string(), z.unknown()),
			})
			.strict(),
		sourceText: z.string(),
		files: z.array(
			z
				.object({
					path: z.string(),
					sizeBytes: z.number().int().nonnegative(),
					mode: z.number().int().nonnegative(),
					contentBase64: z.string(),
					textContent: z.string().nullable(),
				})
				.strict(),
		),
		bundledManifest: z
			.object({
				verdict: z.enum(["safe", "review", "reject"]),
				entries: z.array(
					z
						.object({
							rawPath: z.string(),
							normalizedPath: z.string().nullable(),
							category: z.enum(["scripts", "references", "assets", "custom", "out_of_root", "invalid"]),
							findings: z.array(fileFindingSchema),
						})
						.strict(),
				),
				findings: z.array(fileFindingSchema),
				reason: z.string(),
			})
			.strict(),
		executableScreen: z
			.object({
				verdict: z.enum(["safe", "quarantine"]),
				files: z.array(
					z.object({ path: z.string(), flagged: z.boolean(), reason: z.string().nullable() }).strict(),
				),
			})
			.strict(),
		injectionScreen: z
			.object({
				verdict: z.enum(["safe", "review", "reject"]),
				findings: z.array(
					z
						.object({
							code: z.string(),
							severity: z.enum(["review", "reject"]),
							message: z.string(),
							evidence: z.string(),
						})
						.strict(),
				),
				reason: z.string(),
			})
			.strict(),
		capabilityGrant: z
			.object({
				granted: z.array(z.string()),
				denied: z.array(
					z.object({ tool: z.string(), reason: z.literal("not_in_allowed_set"), detail: z.string() }).strict(),
				),
				effectiveTools: z.array(z.string()),
				posture: z.enum(["undeclared", "empty_declaration", "fully_granted", "partially_granted", "fully_denied"]),
				reason: z.string(),
			})
			.strict(),
		disposition: z.enum(["candidate", "quarantine", "reject"]),
		priorPin: z
			.object({
				id: z.string(),
				contentHash: z.string(),
				version: z.string().nullable(),
				trust: z.string(),
				pinnedAt: z.number(),
			})
			.strict()
			.nullable(),
		drift: z
			.object({
				kind: z.enum(["unpinned", "unchanged", "content-drift", "version-bump", "version-and-content"]),
				drifted: z.boolean(),
				rugPull: z.boolean(),
				reason: z.string(),
			})
			.strict(),
		decision: importDecisionSchema,
		channel: z.literal("user-review-only"),
		promptEligible: z.literal(false),
		active: z.literal(false),
	})
	.strict();
export type RuntimeCommunitySkillImportReviewResponse = z.infer<typeof runtimeCommunitySkillImportReviewResponseSchema>;

export const runtimeCommunitySkillImportApproveRequestSchema = runtimeCommunitySkillImportReviewRequestSchema
	.extend({ expectedContentHash: contentHashSchema, confirmation: z.literal(true) })
	.strict();
export type RuntimeCommunitySkillImportApproveRequest = z.infer<typeof runtimeCommunitySkillImportApproveRequestSchema>;

export const runtimeCommunitySkillImportApproveResponseSchema = z
	.object({
		skillId: z.string(),
		contentHash: contentHashSchema,
		snapshotId: z.string(),
		importedAt: z.number(),
		active: z.literal(false),
		quarantined: z.literal(true),
		decision: importDecisionSchema,
	})
	.strict();
export type RuntimeCommunitySkillImportApproveResponse = z.infer<
	typeof runtimeCommunitySkillImportApproveResponseSchema
>;
