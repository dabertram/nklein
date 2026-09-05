import { describe, expect, it } from "vitest";
import { extractConflictHunks, renderConflictHunkDigest } from "../../../src/nklein-agent/merge-conflict-hunks";

const conflicted = [
	"line 1",
	"line 2",
	"<<<<<<< HEAD",
	"ours",
	"=======",
	"theirs",
	">>>>>>> b30b97d (Apply task result)",
	"line 8",
	"line 9",
	"line 10",
	"<<<<<<< HEAD",
	"ours 2",
	"=======",
	"theirs 2",
	">>>>>>> b30b97d",
	"line 16",
].join("\n");

describe("extractConflictHunks (merge-resolution seed, live 2026-09-05)", () => {
	it("returns every marker region with numbered context lines", () => {
		const hunks = extractConflictHunks(conflicted, 2);
		expect(hunks.map((hunk) => [hunk.startLine, hunk.endLine])).toEqual([
			[3, 7],
			[11, 15],
		]);
		expect(hunks[0]?.excerpt.split("\n")).toEqual([
			"   1 | line 1",
			"   2 | line 2",
			"   3 | <<<<<<< HEAD",
			"   4 | ours",
			"   5 | =======",
			"   6 | theirs",
			"   7 | >>>>>>> b30b97d (Apply task result)",
			"   8 | line 8",
			"   9 | line 9",
		]);
	});

	it("ignores an unterminated marker and a file without markers", () => {
		expect(extractConflictHunks("<<<<<<< HEAD\nours\n=======\ntheirs\n")).toEqual([]);
		expect(extractConflictHunks("plain\nfile\n")).toEqual([]);
	});
});

describe("renderConflictHunkDigest", () => {
	it("renders one block per conflicted file and keeps files whole under the budget", () => {
		const digest = renderConflictHunkDigest(
			[
				{ path: "src/a.ts", content: conflicted },
				{ path: "src/clean.ts", content: "no markers\n" },
				{ path: "src/b.ts", content: conflicted },
			],
			{ contextLines: 1 },
		);
		expect(digest.hunkCount).toBe(4);
		expect(digest.omittedPaths).toEqual([]);
		expect(digest.text).toContain("### src/a.ts — 2 conflicts");
		expect(digest.text).toContain("### src/b.ts — 2 conflicts");
		expect(digest.text).not.toContain("src/clean.ts");
	});

	it("omits whole files (and everything after) once the budget is exhausted", () => {
		const digest = renderConflictHunkDigest(
			[
				{ path: "src/a.ts", content: conflicted },
				{ path: "src/b.ts", content: conflicted },
			],
			// One file's block (header + two 7-line numbered hunks) is ~320 chars: the first fits, the second cannot.
			{ contextLines: 1, budgetChars: 400 },
		);
		expect(digest.text).toContain("### src/a.ts");
		expect(digest.omittedPaths).toEqual(["src/b.ts"]);
		expect(digest.hunkCount).toBe(2);
	});
});
