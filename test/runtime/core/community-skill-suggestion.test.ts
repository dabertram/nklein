import { describe, expect, it } from "vitest";
import {
	buildCommunitySkillSuggestionFragment,
	rankCommunitySkillSuggestions,
} from "../../../src/core/community-skill-suggestion";

describe("rankCommunitySkillSuggestions", () => {
	it("ranks pinned metadata deterministically without admitting zero-overlap skills", () => {
		const base = {
			version: null,
			contentHash: "a".repeat(64),
			sourceUrl: "https://example.test/skill",
		};
		const result = rankCommunitySkillSuggestions("Review repository security and tests", [
			{
				...base,
				snapshotId: `${"1".repeat(32)}/${"a".repeat(64)}`,
				skillId: "security-review",
				name: "security-review",
				description: "Review repository security boundaries",
			},
			{
				...base,
				snapshotId: `${"2".repeat(32)}/${"a".repeat(64)}`,
				skillId: "testing",
				name: "testing",
				description: "Run repository tests",
			},
			{
				...base,
				snapshotId: `${"3".repeat(32)}/${"a".repeat(64)}`,
				skillId: "gardening",
				name: "gardening",
				description: "Plant flowers outdoors",
			},
		]);
		expect(result.map((item) => item.skillId)).toEqual(["security-review", "testing"]);
		expect(result[0]?.matchedTerms).toEqual(["repository", "review", "security"]);
	});

	it("renders only metadata inside the untrusted-data fence for planner suggestion", () => {
		const [ranked] = rankCommunitySkillSuggestions("review repository", [
			{
				snapshotId: `${"1".repeat(32)}/${"a".repeat(64)}`,
				skillId: "security-review",
				name: "security-review",
				description: "Review repository boundaries",
				version: null,
				contentHash: "a".repeat(64),
				sourceUrl: "https://example.test/skill",
			},
		]);
		if (!ranked) throw new Error("Expected a ranked fixture.");
		const fragment = buildCommunitySkillSuggestionFragment([ranked]);
		expect(fragment?.text).toContain("BEGIN UNTRUSTED CONTENT");
		expect(fragment?.text).toContain('"promptEligible":false');
		expect(fragment?.text).toContain("separate human review and approval");
		expect(fragment?.text).not.toContain("secret procedural body");
	});
});
