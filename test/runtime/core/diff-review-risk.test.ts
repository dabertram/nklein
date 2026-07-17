import { describe, expect, it } from "vitest";
import {
	classifyDiffReviewRisk,
	diffTouchedFiles,
	REVIEW_FATIGUE_ADDED_LINES,
} from "../../../src/core/diff-review-risk";

function diffFor(files: string[], addedLinesPerFile = 3): string {
	return files
		.map((file) =>
			[
				`diff --git a/${file} b/${file}`,
				`--- a/${file}`,
				`+++ b/${file}`,
				"@@ -1,1 +1,4 @@",
				...Array.from({ length: addedLinesPerFile }, (_, index) => `+line ${index}`),
			].join("\n"),
		)
		.join("\n");
}

describe("classifyDiffReviewRisk (F12.54)", () => {
	it("routes auth-touching diffs to deep review with a failure-mode demand", () => {
		const risk = classifyDiffReviewRisk(diffFor(["src/core/auth-session.ts", "src/util/strings.ts"]));
		expect(risk.tier).toBe("deep_review");
		expect(risk.riskSignals[0]?.category).toBe("auth/security");
		expect(risk.directive).toContain("failure mode");
	});

	it("fast-tracks docs/tests-only diffs and keeps mixed diffs standard", () => {
		expect(classifyDiffReviewRisk(diffFor(["docs/guide.md", "test/core/foo.test.ts"])).tier).toBe("fast_track");
		expect(classifyDiffReviewRisk(diffFor(["src/util/strings.ts"])).tier).toBe("standard");
		// A test file next to a source file is NOT fast-track — the source change still needs the full pass.
		expect(classifyDiffReviewRisk(diffFor(["src/util/strings.ts", "test/core/foo.test.ts"])).tier).toBe("standard");
	});

	it("flags oversized diffs with a split hint past the fatigue threshold", () => {
		const risk = classifyDiffReviewRisk(diffFor(["src/util/strings.ts"], REVIEW_FATIGUE_ADDED_LINES + 1));
		expect(risk.oversized).toBe(true);
		expect(risk.directive).toContain("FATIGUE WARNING");
		expect(risk.directive).toContain("split");
	});

	it("parses touched files from unified-diff headers, ignoring deletions", () => {
		const diff = ["+++ b/src/a.ts", "+++ /dev/null", "+++ b/docs/x.md"].join("\n");
		expect(diffTouchedFiles(diff)).toEqual(["src/a.ts", "docs/x.md"]);
	});

	it("classifies migration and contract paths as deep review", () => {
		expect(classifyDiffReviewRisk(diffFor(["db/migrations/0042_add_users.sql"])).tier).toBe("deep_review");
		expect(classifyDiffReviewRisk(diffFor(["src/core/board-api-contract.ts"])).tier).toBe("deep_review");
	});

	it("does not cry wolf on authors/oracle paths while still catching real auth/acl files (review-found)", () => {
		expect(classifyDiffReviewRisk(diffFor(["src/blog/authors.ts"])).tier).toBe("standard");
		expect(classifyDiffReviewRisk(diffFor(["src/db/oracle-connector.ts"])).tier).toBe("standard");
		expect(classifyDiffReviewRisk(diffFor(["src/core/auth-session.ts"])).tier).toBe("deep_review");
		expect(classifyDiffReviewRisk(diffFor(["src/net/acl.ts"])).tier).toBe("deep_review");
		expect(classifyDiffReviewRisk(diffFor(["src/authentication/login.ts"])).tier).toBe("deep_review");
	});
});
