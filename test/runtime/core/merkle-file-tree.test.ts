import { describe, expect, it } from "vitest";
import { buildFileHashTree, diffFileHashTrees } from "../../../src/core/merkle-file-tree";

const SNAPSHOT = [
	{ path: "src/a.ts", hash: "h1" },
	{ path: "src/deep/b.ts", hash: "h2" },
	{ path: "docs/readme.md", hash: "h3" },
];

describe("buildFileHashTree (F12.67)", () => {
	it("is deterministic across entry order and bubbles deep changes to the root", () => {
		const tree = buildFileHashTree(SNAPSHOT);
		const shuffled = buildFileHashTree([...SNAPSHOT].reverse());
		expect(shuffled.rootHash).toBe(tree.rootHash);
		const deepChange = buildFileHashTree(
			SNAPSHOT.map((entry) => (entry.path === "src/deep/b.ts" ? { ...entry, hash: "CHANGED" } : entry)),
		);
		expect(deepChange.rootHash).not.toBe(tree.rootHash);
		// The untouched sibling directory's hash is stable — the subtree-skip signal.
		expect(deepChange.dirHashes.get("docs")).toBe(tree.dirHashes.get("docs"));
		expect(deepChange.dirHashes.get("src/deep")).not.toBe(tree.dirHashes.get("src/deep"));
	});
});

describe("diffFileHashTrees (F12.67)", () => {
	it("short-circuits identical snapshots", () => {
		const diff = diffFileHashTrees(buildFileHashTree(SNAPSHOT), buildFileHashTree([...SNAPSHOT]));
		expect(diff).toEqual({ identical: true, changedFiles: [], removedFiles: [], unchangedShare: 1 });
	});

	it("yields the minimal re-process set: changed + added + removed, with the reuse share", () => {
		const next = buildFileHashTree([
			{ path: "src/a.ts", hash: "h1" },
			{ path: "src/deep/b.ts", hash: "NEW" },
			{ path: "src/new.ts", hash: "h4" },
		]);
		const diff = diffFileHashTrees(buildFileHashTree(SNAPSHOT), next);
		expect(diff.identical).toBe(false);
		expect(diff.changedFiles).toEqual(["src/deep/b.ts", "src/new.ts"]);
		expect(diff.removedFiles).toEqual(["docs/readme.md"]);
		expect(diff.unchangedShare).toBeCloseTo(1 / 3);
	});
});
