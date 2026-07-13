import { describe, expect, it } from "vitest";
import {
	buildKleinCorpusProvenance,
	buildRankedCorpusProvenance,
	DEFAULT_CORPUS_STALENESS_MS,
	KLEIN_CORPUS_SOURCE_PATH,
} from "../../../src/core/klein-self-corpus-provenance";

/**
 * F2.19 — corpus freshness/provenance: each doc cites its exact source path + age, flags staleness (unknown
 * time fails cautious to stale), and carries the commit sha when supplied.
 */

const NOW = 10_000_000_000;

describe("buildKleinCorpusProvenance", () => {
	it("cites path + fresh age + commit and is NOT stale within the threshold", () => {
		const p = buildKleinCorpusProvenance(
			{ doc: "done", lastModifiedMs: NOW - 3 * 60 * 60 * 1000, commitSha: "abc1234" },
			{ now: NOW },
		);
		expect(p.path).toBe("done.md");
		expect(p.stale).toBe(false);
		expect(p.commitSha).toBe("abc1234");
		expect(p.citation).toBe("done.md (updated 3h ago, commit abc1234)");
	});

	it("flags stale content past the threshold", () => {
		const p = buildKleinCorpusProvenance(
			{ doc: "todo", lastModifiedMs: NOW - (DEFAULT_CORPUS_STALENESS_MS + 60_000) },
			{ now: NOW },
		);
		expect(p.stale).toBe(true);
		expect(p.citation).toContain("todo.md");
		expect(p.citation).toContain("may be stale");
	});

	it("treats unknown last-modified time as stale (cautious) with a freshness-unknown citation", () => {
		const p = buildKleinCorpusProvenance({ doc: "agents", lastModifiedMs: null }, { now: NOW });
		expect(p.ageMs).toBeNull();
		expect(p.stale).toBe(true);
		expect(p.citation).toContain("AGENTS.md");
		expect(p.citation).toContain("freshness unknown");
	});

	it("maps every doc to its canonical source path", () => {
		expect(KLEIN_CORPUS_SOURCE_PATH).toEqual({
			done: "done.md",
			todo: "todo.md",
			agents: "AGENTS.md",
			changelog: "CHANGELOG.md",
			docs: "docs/",
		});
	});

	it("buildRankedCorpusProvenance preserves order and applies a custom threshold", () => {
		const ranked = buildRankedCorpusProvenance(
			[
				{ doc: "done", lastModifiedMs: NOW - 1000 },
				{ doc: "todo", lastModifiedMs: NOW - 2000 },
			],
			{ now: NOW, stalenessThresholdMs: 500 },
		);
		expect(ranked.map((r) => r.doc)).toEqual(["done", "todo"]);
		expect(ranked.every((r) => r.stale)).toBe(true); // both older than the 500ms custom threshold
	});
});
