import { describe, expect, it } from "vitest";

import {
	appendTaskContextBlock,
	formatGitHubContextLabel,
	parseGitHubContextTarget,
	renderGitHubIssueContext,
} from "../../../src/core/task-context-import";

describe("task context import helpers", () => {
	it("parses GitHub issue and PR references from URLs and shorthand", () => {
		expect(parseGitHubContextTarget("owner/repo#123")).toEqual({
			owner: "owner",
			repo: "repo",
			number: "123",
		});
		expect(parseGitHubContextTarget("https://github.com/nklein/app/issues/42")).toEqual({
			owner: "nklein",
			repo: "app",
			number: "42",
		});
		expect(parseGitHubContextTarget("https://github.com/nklein/app/pull/7")).toEqual({
			owner: "nklein",
			repo: "app",
			number: "7",
		});
	});

	it("rejects non-GitHub targets", () => {
		expect(() => parseGitHubContextTarget("https://example.com/owner/repo/issues/1")).toThrow(
			"Only github.com URLs are supported.",
		);
		expect(() => parseGitHubContextTarget("owner/repo")).toThrow("Use a GitHub URL or owner/repo#number.");
	});

	it("renders issue JSON and appends it as a fenced context block", () => {
		const issueText = renderGitHubIssueContext({
			title: "Fix setup flow",
			state: "OPEN",
			url: "https://github.com/owner/repo/issues/9",
			labels: [{ name: "bug" }],
			body: "The setup flow exits early.",
			comments: [{ author: { login: "david" }, body: "Happens with local models." }],
		});

		expect(issueText).toContain("# Fix setup flow");
		expect(issueText).toContain("Labels: bug");
		expect(issueText).toContain("## david");
		expect(
			appendTaskContextBlock(
				"Implement the fix.",
				formatGitHubContextLabel("github_issue", {
					owner: "owner",
					repo: "repo",
					number: "9",
				}),
				issueText,
			),
		).toContain("Context from GitHub issue owner/repo#9:");
	});
});
