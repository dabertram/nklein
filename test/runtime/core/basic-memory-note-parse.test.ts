import { describe, expect, it } from "vitest";
import { parseBasicMemoryNote } from "../../../src/core/basic-memory-note-parse.js";

/** F5.2 — the effectful reader's pure parser: raw basic-memory markdown → AuditableMemoryNote. */
describe("parseBasicMemoryNote", () => {
	const at = 1_700_000_000_000;

	it("reads the frontmatter title and body wikilinks", () => {
		const content = [
			"---",
			"title: Fleet three machines connected",
			"type: note",
			"permalink: main/fleet-three-machines-connected",
			"---",
			"",
			"# Fleet three machines connected",
			"",
			"See [[machine-aware-load-routing]] and [[live-review-stall-unloaded-role-model]].",
			"",
		].join("\n");
		const note = parseBasicMemoryNote({ id: "main/fleet-three-machines-connected", content, updatedAt: at });
		expect(note).toEqual({
			id: "main/fleet-three-machines-connected",
			title: "Fleet three machines connected",
			updatedAt: at,
			links: ["machine-aware-load-routing", "live-review-stall-unloaded-role-model"],
		});
	});

	it("strips a single pair of wrapping quotes from the frontmatter title", () => {
		const content = ["---", 'title: "Quoted: with a colon"', "---", "body"].join("\n");
		expect(parseBasicMemoryNote({ id: "x", content, updatedAt: at }).title).toBe("Quoted: with a colon");
	});

	it("falls back to the first heading, then to the id, when no frontmatter title exists", () => {
		const headingOnly = parseBasicMemoryNote({ id: "id-1", content: "## Real heading\n\ntext", updatedAt: at });
		expect(headingOnly.title).toBe("Real heading");
		const bare = parseBasicMemoryNote({ id: "id-2", content: "just body text, no heading", updatedAt: at });
		expect(bare.title).toBe("id-2");
	});

	it("strips alias pipes and section anchors from link targets and dedupes case-insensitively", () => {
		const content = "[[Target Note|shown text]] and [[Target Note#a-section]] and [[target note]] and [[Other]]";
		expect(parseBasicMemoryNote({ id: "x", content, updatedAt: at }).links).toEqual(["Target Note", "Other"]);
	});

	it("does NOT treat a wikilink inside frontmatter as an outgoing body link", () => {
		const content = ["---", "title: T", "note: [[not-a-body-link]]", "---", "body links [[real]]"].join("\n");
		expect(parseBasicMemoryNote({ id: "x", content, updatedAt: at }).links).toEqual(["real"]);
	});

	it("normalizes CRLF and tolerates an unterminated frontmatter fence without throwing", () => {
		const crlf = parseBasicMemoryNote({ id: "x", content: "---\r\ntitle: CR\r\n---\r\nbody [[a]]", updatedAt: at });
		expect(crlf.title).toBe("CR");
		expect(crlf.links).toEqual(["a"]);
		// Unterminated fence: the whole thing is body, title falls back to the id, and body links still parse.
		const unterminated = parseBasicMemoryNote({
			id: "id",
			content: "---\ntitle: never closes\n[[a]]",
			updatedAt: at,
		});
		expect(unterminated.title).toBe("id");
		expect(unterminated.links).toEqual(["a"]);
	});

	it("returns no links for a note with none, and ignores empty [[]] targets", () => {
		const note = parseBasicMemoryNote({ id: "x", content: "# H\n\nplain text [[]] and [[  ]]", updatedAt: at });
		expect(note.links).toEqual([]);
	});
});
