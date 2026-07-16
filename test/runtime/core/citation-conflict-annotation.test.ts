import { describe, expect, it } from "vitest";
import { type AnnotatedConflict, annotateSynthesisWithConflicts } from "../../../src/core/citation-conflict-annotation";

const resolved: AnnotatedConflict = {
	cluster: {
		claimKey: "Node LTS version",
		claims: [
			{ claimKey: "Node LTS version", value: "20", sourceId: "old-blog" },
			{ claimKey: "Node LTS version", value: "22", sourceId: "nodejs.org" },
		],
		distinctValues: ["20", "22"],
	},
	resolution: {
		winnerId: "nodejs.org",
		supersededIds: ["old-blog"],
		unresolved: false,
		reason: "prefer fresh/official",
	},
};

const unresolvedEntry: AnnotatedConflict = {
	cluster: {
		claimKey: "release date",
		claims: [
			{ claimKey: "release date", value: "March", sourceId: "src-a" },
			{ claimKey: "release date", value: "April", sourceId: "src-b" },
		],
		distinctValues: ["March", "April"],
	},
	resolution: { winnerId: null, supersededIds: ["src-a", "src-b"], unresolved: true, reason: "no clear winner" },
};

describe("annotateSynthesisWithConflicts", () => {
	it("returns the answer UNCHANGED when there are no conflicts", () => {
		expect(annotateSynthesisWithConflicts("The answer.", [])).toBe("The answer.");
	});

	it("appends a resolved conflict note naming the winner and the retained minority", () => {
		const out = annotateSynthesisWithConflicts("Node's current LTS is 22.", [resolved]);
		expect(out).toContain("## Source-conflict notes");
		expect(out).toContain("**Node LTS version**: using **22** (from nodejs.org)");
		expect(out).toContain("Superseded: 20 (old-blog)");
		expect(out).toContain("prefer fresh/official");
		// The original answer is preserved above the notes.
		expect(out.startsWith("Node's current LTS is 22.")).toBe(true);
	});

	it("marks an unresolved conflict explicitly with both views", () => {
		const out = annotateSynthesisWithConflicts("The release shipped.", [unresolvedEntry]);
		expect(out).toContain("**release date**: UNRESOLVED");
		expect(out).toContain("March (src-a)");
		expect(out).toContain("April (src-b)");
		expect(out).toContain("Verify before relying on it.");
	});

	it("renders multiple conflicts in input order under one section", () => {
		const out = annotateSynthesisWithConflicts("Body.", [resolved, unresolvedEntry]);
		expect(out.indexOf("Node LTS version")).toBeLessThan(out.indexOf("release date"));
		expect(out.match(/## Source-conflict notes/g)).toHaveLength(1);
	});

	it("handles an empty answer without a leading blank line", () => {
		const out = annotateSynthesisWithConflicts("", [resolved]);
		expect(out.startsWith("## Source-conflict notes")).toBe(true);
	});
});
