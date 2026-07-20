import { describe, expect, it } from "vitest";
import {
	buildBlameArgs,
	type ChurnGitPort,
	collectChurnForCard,
	countAttributedLines,
} from "../../src/core/churn-collector";

function git(survivalByPath: Record<string, number | null>): ChurnGitPort {
	return {
		countSurvivingLines: async ({ path }) => survivalByPath[path] ?? null,
	};
}

describe("collectChurnForCard", () => {
	it("counts surviving lines across files", async () => {
		const result = await collectChurnForCard({
			cardId: "c1",
			commit: "abc123",
			laterRef: "HEAD",
			files: [
				{ path: "a.ts", authoredLines: 100 },
				{ path: "b.ts", authoredLines: 50 },
			],
			git: git({ "a.ts": 90, "b.ts": 20 }),
		});
		expect(result.authoredLines).toBe(150);
		expect(result.survivingLines).toBe(110);
		expect(result.churnedLines).toBe(40);
	});

	it("counts an UNREADABLE file as fully churned AND names it", async () => {
		// Counting it as surviving would hide a DELETED file — the strongest churn signal there is — behind a read
		// error. Counting it silently would make the denominator lie. Both halves are needed.
		const result = await collectChurnForCard({
			cardId: "c1",
			commit: "abc123",
			laterRef: "HEAD",
			files: [
				{ path: "kept.ts", authoredLines: 40 },
				{ path: "deleted.ts", authoredLines: 60 },
			],
			git: git({ "kept.ts": 40, "deleted.ts": null }),
		});
		expect(result.churnedLines).toBe(60);
		expect(result.unreadableFiles).toEqual(["deleted.ts"]);
		expect(result.summary).toContain("counted as fully churned");
	});

	it("CLAMPS survival above authorship rather than producing negative churn", async () => {
		// Blame can attribute more lines than the card authored when a later commit re-indents around them.
		// Negative churn would read as 'the card added lines after the fact' — a nonsense a reader would not believe.
		const result = await collectChurnForCard({
			cardId: "c1",
			commit: "abc123",
			laterRef: "HEAD",
			files: [{ path: "a.ts", authoredLines: 10 }],
			git: git({ "a.ts": 999 }),
		});
		expect(result.survivingLines).toBe(10);
		expect(result.churnedLines).toBe(0);
	});

	it("survives a throwing git port rather than failing the whole collection", async () => {
		const result = await collectChurnForCard({
			cardId: "c1",
			commit: "abc123",
			laterRef: "HEAD",
			files: [{ path: "a.ts", authoredLines: 10 }],
			git: {
				countSurvivingLines: async () => {
					throw new Error("git exploded");
				},
			},
		});
		expect(result.unreadableFiles).toEqual(["a.ts"]);
	});

	it("says UNMEASURED rather than zero when no lines were authored", async () => {
		const result = await collectChurnForCard({
			cardId: "c1",
			commit: "abc",
			laterRef: "HEAD",
			files: [],
			git: git({}),
		});
		expect(result.summary).toContain("not the same as zero");
	});
});

describe("buildBlameArgs", () => {
	it("uses line-porcelain, which is what makes per-commit counting possible", () => {
		expect(buildBlameArgs({ path: "a.ts", ref: "HEAD" })).toContain("--line-porcelain");
	});

	it("ignores whitespace so a re-indent does not read as a rewrite", () => {
		expect(buildBlameArgs({ path: "a.ts", ref: "HEAD" })).toContain("-w");
	});

	it("puts the path after `--` so a filename matching a ref is not misread", () => {
		const args = buildBlameArgs({ path: "HEAD", ref: "main" });
		expect(args.indexOf("--")).toBeLessThan(args.indexOf("HEAD", args.indexOf("--")));
	});
});

describe("countAttributedLines", () => {
	const porcelain = [
		"abc1234567890 1 1 2",
		"author Someone",
		"\tline one",
		"abc1234567890 2 2",
		"author Someone",
		"\tline two",
		"def9876543210 3 3 1",
		"author Other",
		"\tline three",
	].join("\n");

	it("counts only lines attributed to the given commit", () => {
		expect(countAttributedLines(porcelain, "abc1234567890")).toBe(2);
		expect(countAttributedLines(porcelain, "def9876543210")).toBe(1);
	});

	it("accepts a SHORT sha, since callers rarely hold the full one", () => {
		expect(countAttributedLines(porcelain, "abc1234")).toBe(2);
	});

	it("is case-insensitive about the sha", () => {
		expect(countAttributedLines(porcelain, "ABC1234")).toBe(2);
	});

	it("returns 0 for an empty commit rather than matching everything", () => {
		// A blank prefix would `startsWith`-match every line and report total survival — a silent, flattering lie.
		expect(countAttributedLines(porcelain, "")).toBe(0);
		expect(countAttributedLines(porcelain, "   ")).toBe(0);
	});

	it("does not count author or content lines as attributions", () => {
		expect(countAttributedLines(porcelain, "author")).toBe(0);
	});
});
