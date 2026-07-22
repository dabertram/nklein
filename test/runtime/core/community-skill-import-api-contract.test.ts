import { describe, expect, it } from "vitest";
import {
	runtimeCommunitySkillImportApproveRequestSchema,
	runtimeCommunitySkillImportReviewRequestSchema,
} from "../../../src/core/community-skill-import-api-contract";

describe("community skill import API contract", () => {
	it("accepts one immediate staged directory and an explicit hash-bound confirmation", () => {
		expect(
			runtimeCommunitySkillImportApproveRequestSchema.parse({
				directory: "reviewer",
				sourceUrl: "https://example.test/reviewer",
				expectedContentHash: "a".repeat(64),
				confirmation: true,
			}),
		).toMatchObject({ directory: "reviewer", confirmation: true });
	});

	it("rejects traversal, extra fields, malformed digests, and missing confirmation", () => {
		expect(
			runtimeCommunitySkillImportReviewRequestSchema.safeParse({
				directory: "../reviewer",
				sourceUrl: "https://example.test/reviewer",
			}),
		).toMatchObject({ success: false });
		expect(
			runtimeCommunitySkillImportReviewRequestSchema.safeParse({
				directory: "reviewer",
				sourceUrl: "https://example.test/reviewer",
				extra: true,
			}),
		).toMatchObject({ success: false });
		expect(
			runtimeCommunitySkillImportApproveRequestSchema.safeParse({
				directory: "reviewer",
				sourceUrl: "https://example.test/reviewer",
				expectedContentHash: "short",
			}),
		).toMatchObject({ success: false });
	});
});
