import { z } from "zod";

export const runtimeCommunitySkillDiscoveryRequestSchema = z
	.object({
		query: z.string().max(1_024),
		includeUntrusted: z.boolean().optional(),
		maxResults: z.number().int().min(1).max(100).optional(),
	})
	.strict();
export type RuntimeCommunitySkillDiscoveryRequest = z.infer<typeof runtimeCommunitySkillDiscoveryRequestSchema>;

export const runtimeCommunitySkillDiscoveryResultSchema = z
	.object({
		title: z.string(),
		sourceUrl: z.string(),
		sourceTrust: z.enum(["trusted", "untrusted"]),
		discoveryTrust: z.enum(["trusted", "untrusted"]),
		discoveredVia: z.object({ id: z.string(), label: z.string(), baseUrl: z.string() }).strict(),
		displayOnly: z.literal(true),
		promptEligible: z.literal(false),
	})
	.strict();

export const runtimeCommunitySkillDiscoveryResponseSchema = z
	.object({
		query: z.string(),
		includedUntrusted: z.boolean(),
		channel: z.literal("user-review-only"),
		results: z.array(runtimeCommunitySkillDiscoveryResultSchema),
		failures: z.array(
			z
				.object({
					originId: z.string(),
					code: z.enum(["no_backend", "blocked_by_egress", "backend_error", "empty_query", "search_failed"]),
				})
				.strict(),
		),
	})
	.strict();
export type RuntimeCommunitySkillDiscoveryResponse = z.infer<typeof runtimeCommunitySkillDiscoveryResponseSchema>;
