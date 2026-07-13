import { describe, expect, it } from "vitest";
import {
	buildKleinSelfCorpusNote,
	type KleinCorpusFreshnessReader,
	renderKleinSelfCorpusNote,
} from "../../../src/chat/klein-self-corpus-note";
import { DEFAULT_CORPUS_STALENESS_MS } from "../../../src/core/klein-self-corpus-provenance";
import { routeKleinSelfCorpus } from "../../../src/core/klein-self-corpus-routing";

const NOW = 10_000_000_000;

/** A freshness reader that reports every doc as freshly updated `ageMs` ago with a fixed sha. */
function freshReader(ageMs: number, sha: string | null = "abc1234"): KleinCorpusFreshnessReader {
	return async () => ({ lastModifiedMs: NOW - ageMs, commitSha: sha });
}

describe("renderKleinSelfCorpusNote (F2.20b)", () => {
	it("returns null when there is no provenance to ground on", () => {
		const route = routeKleinSelfCorpus("what features exist", { availableDocs: [] });
		expect(renderKleinSelfCorpusNote(route, [])).toBeNull();
	});
});

describe("buildKleinSelfCorpusNote (F2.19b + F2.20b)", () => {
	it("returns null when there is no source repo root", async () => {
		const note = await buildKleinSelfCorpusNote("what features exist", {
			now: NOW,
			repoRoot: null,
			readDocFreshness: freshReader(1000),
		});
		expect(note).toBeNull();
	});

	it("leads with done.md for an existing-feature question and cites its freshness + commit", async () => {
		const note = await buildKleinSelfCorpusNote("what features does !Klein support", {
			now: NOW,
			repoRoot: "/repo",
			readDocFreshness: freshReader(60_000, "deadbee"),
		});
		expect(note).not.toBeNull();
		const lines = (note as string).split("\n");
		const firstRanked = lines.find((line) => line.startsWith("1. "));
		expect(firstRanked).toContain("done.md");
		expect(firstRanked).toContain("commit deadbee");
		expect(note).toContain("read tools");
		expect(note).toContain("Routing:");
	});

	it("routes a known-bug question to todo.md first", async () => {
		const note = await buildKleinSelfCorpusNote("is the swarm scheduler a known bug", {
			now: NOW,
			repoRoot: "/repo",
			readDocFreshness: freshReader(60_000),
		});
		const firstRanked = (note as string).split("\n").find((line) => line.startsWith("1. "));
		expect(firstRanked).toContain("todo.md");
	});

	it("marks a doc that predates the staleness window as stale, and a recent one as fresh", async () => {
		const readDocFreshness: KleinCorpusFreshnessReader = async (doc) =>
			doc === "done"
				? { lastModifiedMs: NOW - DEFAULT_CORPUS_STALENESS_MS - 1, commitSha: "old1234" }
				: { lastModifiedMs: NOW - 60_000, commitSha: "new1234" };
		const note = (await buildKleinSelfCorpusNote("what features exist", {
			now: NOW,
			repoRoot: "/repo",
			readDocFreshness,
		})) as string;
		const doneLine = note.split("\n").find((line) => line.includes("done.md")) as string;
		const todoLine = note.split("\n").find((line) => line.includes("todo.md")) as string;
		expect(doneLine).toContain("may be stale");
		expect(todoLine).not.toContain("may be stale");
	});

	it("marks an unknown-freshness doc as stale (fails cautious)", async () => {
		const note = (await buildKleinSelfCorpusNote("what features exist", {
			now: NOW,
			repoRoot: "/repo",
			readDocFreshness: async () => ({ lastModifiedMs: null, commitSha: null }),
		})) as string;
		const doneLine = note.split("\n").find((line) => line.includes("done.md")) as string;
		expect(doneLine).toContain("freshness unknown");
		expect(doneLine).toContain("may be stale");
	});

	it("restricts the note to availableDocs when supplied", async () => {
		// An existing-feature question leads with done.md (its rationale never names another doc), so the only doc
		// references in the note are the ranked citations — which availableDocs must limit to done + todo.
		const note = (await buildKleinSelfCorpusNote("what features exist", {
			now: NOW,
			repoRoot: "/repo",
			readDocFreshness: freshReader(60_000),
			availableDocs: ["done", "todo"],
		})) as string;
		expect(note).toContain("done.md");
		expect(note).toContain("todo.md");
		expect(note).not.toContain("docs/");
		expect(note).not.toContain("AGENTS.md");
		expect(note).not.toContain("CHANGELOG.md");
	});
});
