import { describe, expect, it } from "vitest";
import { type BasicMemoryFsDeps, readBasicMemoryNotes } from "../../../src/core/basic-memory-note-reader.js";

/** F5.2 — the effectful reader over an injected in-memory tree: walk → read/stat → parse into audit notes. */
function fakeFs(
	tree: Record<string, { content: string; mtimeMs: number }>,
	failPaths: Set<string> = new Set(),
): BasicMemoryFsDeps {
	return {
		async listMarkdownFiles(rootDir: string): Promise<string[]> {
			return Object.keys(tree).filter((p) => p.startsWith(`${rootDir}/`) && p.endsWith(".md"));
		},
		async readFile(path: string): Promise<string> {
			if (failPaths.has(path)) throw new Error("EACCES");
			return tree[path].content;
		},
		async statMtimeMs(path: string): Promise<number> {
			if (failPaths.has(path)) throw new Error("EACCES");
			return tree[path].mtimeMs;
		},
	};
}

describe("readBasicMemoryNotes", () => {
	it("uses the frontmatter permalink as id and the file mtime as updatedAt", async () => {
		const notes = await readBasicMemoryNotes(
			"/bm",
			fakeFs({
				"/bm/decisions/a.md": {
					content: "---\ntitle: Note A\npermalink: main/note-a\n---\nlinks [[note-b]]",
					mtimeMs: 111,
				},
			}),
		);
		expect(notes).toEqual([{ id: "main/note-a", title: "Note A", updatedAt: 111, links: ["note-b"] }]);
	});

	it("falls back to the root-relative path (no .md) as id when a note has no permalink", async () => {
		const notes = await readBasicMemoryNotes(
			"/bm",
			fakeFs({
				"/bm/gotchas/thing here.md": { content: "# Thing\n\nbody", mtimeMs: 222 },
			}),
		);
		expect(notes[0].id).toBe("gotchas/thing here");
		expect(notes[0].title).toBe("Thing");
	});

	it("skips a note that fails to read/stat rather than aborting the whole pass", async () => {
		const tree = {
			"/bm/ok.md": { content: "---\npermalink: ok\n---\nbody", mtimeMs: 1 },
			"/bm/locked.md": { content: "---\npermalink: locked\n---\nbody", mtimeMs: 2 },
		};
		const notes = await readBasicMemoryNotes("/bm", fakeFs(tree, new Set(["/bm/locked.md"])));
		expect(notes.map((n) => n.id)).toEqual(["ok"]);
	});
});
