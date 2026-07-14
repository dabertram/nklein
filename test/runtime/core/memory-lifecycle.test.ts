import { describe, expect, it } from "vitest";
import type { AuditableMemoryNote } from "../../../src/core/memory-freshness-audit.js";
import {
	classifyMemoryLifecycle,
	DEFAULT_MEMORY_LIFECYCLE_CONFIG,
	scoreNoteUtility,
} from "../../../src/core/memory-lifecycle.js";

/** opencode-swarm knowledge-lifecycle port — utility scoring + propose-only promote/retire/merge. */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 400 * DAY;
const note = (id: string, title: string, updatedAt: number, links: string[] = []): AuditableMemoryNote => ({
	id,
	title,
	updatedAt,
	links,
});

describe("scoreNoteUtility", () => {
	it("rewards recency, centrality, and retrieval", () => {
		const fresh = scoreNoteUtility({
			note: note("a", "A", NOW, ["b", "c"]),
			incomingLinkCount: 2,
			retrievalCount: 6,
			config: DEFAULT_MEMORY_LIFECYCLE_CONFIG,
			now: NOW,
		});
		const stale = scoreNoteUtility({
			note: note("z", "Z", 0, []),
			incomingLinkCount: 0,
			retrievalCount: 0,
			config: DEFAULT_MEMORY_LIFECYCLE_CONFIG,
			now: NOW,
		});
		expect(fresh).toBeGreaterThan(stale);
		expect(fresh).toBeGreaterThan(0.8);
		expect(stale).toBe(0);
	});
});

describe("classifyMemoryLifecycle", () => {
	it("proposes promote for a durable, well-connected, frequently-retrieved note", () => {
		const notes = [note("hub", "Hub", NOW - 10 * DAY, ["leaf"]), note("leaf", "Leaf", NOW - 5 * DAY, ["hub"])];
		const recs = classifyMemoryLifecycle(notes, { hub: { retrievalCount: 5 } }, DEFAULT_MEMORY_LIFECYCLE_CONFIG, NOW);
		expect(recs.find((r) => r.noteId === "hub")?.action).toBe("promote");
	});

	it("proposes retire for a stale, orphaned, never-retrieved note", () => {
		const notes = [note("dead", "Dead", 0, []), note("other", "Other", NOW, ["x"])];
		const recs = classifyMemoryLifecycle(notes, {}, DEFAULT_MEMORY_LIFECYCLE_CONFIG, NOW);
		const dead = recs.find((r) => r.noteId === "dead");
		expect(dead?.action).toBe("retire");
		expect(dead?.rationale).toContain("orphaned");
	});

	it("proposes merge for duplicate-title notes (fork), taking precedence over promote/retire", () => {
		const notes = [note("d1", "Same Title", NOW, ["d2"]), note("d2", "same title", NOW, ["d1"])];
		const recs = classifyMemoryLifecycle(notes, { d1: { retrievalCount: 9 } }, DEFAULT_MEMORY_LIFECYCLE_CONFIG, NOW);
		// Even though d1 would otherwise promote, the fork must be reconciled first.
		expect(recs.every((r) => r.action === "merge")).toBe(true);
	});

	it("keeps a note that is neither clearly valuable nor clearly dead, and degrades to 0 retrievals when absent", () => {
		const notes = [note("mid", "Mid", NOW - 30 * DAY, ["x"]), note("x", "X", NOW - 30 * DAY, ["mid"])];
		const recs = classifyMemoryLifecycle(notes, {}, DEFAULT_MEMORY_LIFECYCLE_CONFIG, NOW);
		// Connected (not orphaned) but no retrievals → not promote, not retire → keep.
		expect(recs.find((r) => r.noteId === "mid")?.action).toBe("keep");
	});
});
