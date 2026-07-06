import { describe, expect, it } from "vitest";
import {
	clampGitCommitsPanelWidth,
	clampGitRefsPanelWidth,
	GIT_HISTORY_SEPARATOR_COUNT,
	MIN_GIT_COMMITS_PANEL_WIDTH,
	MIN_GIT_DIFF_PANEL_WIDTH,
	MIN_GIT_REFS_PANEL_WIDTH,
} from "@/resize/use-git-history-layout";

// The 3-panel git-history view (refs | commits | diff) must always leave room for the OTHER two panels + the 2
// separators. These pure clamps encode that reserved-width constraint on top of the shared clampWidthToContainer;
// the primitives are covered in resize-persistence.test.ts — here we pin the git-history-specific composition.
describe("clampGitRefsPanelWidth", () => {
	it("floors at the refs-panel minimum (a tiny requested width can't collapse the panel)", () => {
		expect(clampGitRefsPanelWidth(50, 2000, 360)).toBe(MIN_GIT_REFS_PANEL_WIDTH);
	});

	it("returns an in-range width, rounded", () => {
		expect(clampGitRefsPanelWidth(220.6, 2000, 360)).toBe(221);
	});

	it("caps so the commits panel, the diff-panel minimum, and the separators still fit", () => {
		// ceiling = container − (commitsWidth + MIN_DIFF + separators) = 2000 − (360 + 340 + 2) = 1298
		expect(clampGitRefsPanelWidth(1500, 2000, 360)).toBe(
			2000 - (360 + MIN_GIT_DIFF_PANEL_WIDTH + GIT_HISTORY_SEPARATOR_COUNT),
		);
	});

	it("keeps the panel at its minimum even when the container is too small to fit everything (min wins over a sub-min ceiling)", () => {
		// container 700 with a 260 commits panel leaves ceiling 98 (<180) — the refs panel stays at its 180 min.
		expect(clampGitRefsPanelWidth(200, 700, 260)).toBe(MIN_GIT_REFS_PANEL_WIDTH);
	});

	it("the maximum refs width reserves EXACTLY the commits width + diff-min + separators", () => {
		const container = 1600;
		const commitsWidth = 400;
		const maxRefs = clampGitRefsPanelWidth(Number.POSITIVE_INFINITY, container, commitsWidth);
		expect(maxRefs + commitsWidth + MIN_GIT_DIFF_PANEL_WIDTH + GIT_HISTORY_SEPARATOR_COUNT).toBe(container);
	});
});

describe("clampGitCommitsPanelWidth", () => {
	it("floors at the commits-panel minimum", () => {
		expect(clampGitCommitsPanelWidth(100, 2000, 220)).toBe(MIN_GIT_COMMITS_PANEL_WIDTH);
	});

	it("caps so the refs panel, the diff-panel minimum, and the separators still fit", () => {
		// ceiling = 2000 − (220 + 340 + 2) = 1438
		expect(clampGitCommitsPanelWidth(1600, 2000, 220)).toBe(
			2000 - (220 + MIN_GIT_DIFF_PANEL_WIDTH + GIT_HISTORY_SEPARATOR_COUNT),
		);
	});

	it("the maximum commits width reserves EXACTLY the refs width + diff-min + separators", () => {
		const container = 1500;
		const refsWidth = 240;
		const maxCommits = clampGitCommitsPanelWidth(Number.POSITIVE_INFINITY, container, refsWidth);
		expect(maxCommits + refsWidth + MIN_GIT_DIFF_PANEL_WIDTH + GIT_HISTORY_SEPARATOR_COUNT).toBe(container);
	});
});
