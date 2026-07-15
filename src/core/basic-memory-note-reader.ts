/**
 * F5.2 (effectful b-leaf) — read the on-disk basic-memory knowledge base into {@link AuditableMemoryNote}s for the
 * freshness audit. Basic Memory persists plain Markdown under a project root (`<root>/**​/*.md`); this walks that tree,
 * reads + stats each note, and hands each (content, id, mtime) triple to the pure {@link parseBasicMemoryNote}.
 *
 * The filesystem is injected via {@link BasicMemoryFsDeps} so the walk/parse is unit-testable with an in-memory tree and
 * the live path uses {@link nodeBasicMemoryFsDeps}. The note id is the frontmatter `permalink` when present (so authored
 * `[[permalink]]` links resolve), else the root-relative POSIX path — matching how the audit resolves link targets.
 */

import { parseBasicMemoryNote } from "./basic-memory-note-parse.js";
import type { AuditableMemoryNote } from "./memory-freshness-audit.js";

/** A basic-memory note WITH its body text — the input the F2.9b chat-recall ranker scores against a query. */
export interface BasicMemoryRecallSource {
	permalink: string;
	title: string;
	/** The note body (frontmatter stripped). */
	body: string;
}

/** Drop a leading YAML frontmatter block, returning just the note body. Mirrors {@link readPermalink}'s cheap scan. */
function stripFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return normalized;
	}
	const closeIndex = normalized.indexOf("\n---", 3);
	return closeIndex === -1 ? normalized : normalized.slice(closeIndex + 4).replace(/^\n+/, "");
}

export interface BasicMemoryFsDeps {
	/** Recursively list every `*.md` file under `rootDir`, returned as absolute paths. */
	listMarkdownFiles(rootDir: string): Promise<string[]>;
	/** Read a file's UTF-8 contents. */
	readFile(path: string): Promise<string>;
	/** Last-modified time (ms epoch) from the file stat. */
	statMtimeMs(path: string): Promise<number>;
}

/** Read the frontmatter `permalink` (if any) to use as the stable note id. Cheap top-of-file scan, no YAML dep. */
function readPermalink(content: string): string | null {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return null;
	}
	const closeIndex = normalized.indexOf("\n---", 3);
	const block = closeIndex === -1 ? normalized.slice(4) : normalized.slice(4, closeIndex);
	for (const line of block.split("\n")) {
		const match = line.match(/^permalink:\s*(.*)$/);
		if (match) {
			const value = match[1]
				.trim()
				.replace(/^"(.*)"$/, "$1")
				.replace(/^'(.*)'$/, "$1");
			return value.length > 0 ? value : null;
		}
	}
	return null;
}

/** Root-relative POSIX path with the `.md` suffix dropped — the id fallback when a note has no permalink. */
function relativeNoteId(rootDir: string, absolutePath: string): string {
	const normalizedRoot = rootDir.replace(/\/+$/, "");
	const relative = absolutePath.startsWith(`${normalizedRoot}/`)
		? absolutePath.slice(normalizedRoot.length + 1)
		: absolutePath;
	return relative.replace(/\\/g, "/").replace(/\.md$/i, "");
}

/**
 * Read every note under `rootDir` into audit shape. A file that fails to read/stat is skipped (a hygiene audit must
 * degrade gracefully on a transiently-locked or permission-denied note rather than abort the whole pass).
 */
export async function readBasicMemoryNotes(rootDir: string, deps: BasicMemoryFsDeps): Promise<AuditableMemoryNote[]> {
	const files = await deps.listMarkdownFiles(rootDir);
	const notes: AuditableMemoryNote[] = [];
	for (const path of files) {
		let content: string;
		let updatedAt: number;
		try {
			[content, updatedAt] = await Promise.all([deps.readFile(path), deps.statMtimeMs(path)]);
		} catch {
			continue;
		}
		const id = readPermalink(content) ?? relativeNoteId(rootDir, path);
		notes.push(parseBasicMemoryNote({ id, content, updatedAt }));
	}
	return notes;
}

/**
 * Read every note under `rootDir` WITH its body text — the F2.9b chat-recall source (the audit reader above drops the
 * body). A file that fails to read/stat is skipped (degrade gracefully). The id is the permalink when present, matching
 * the audit's link-target resolution.
 */
export async function readBasicMemoryRecallSources(
	rootDir: string,
	deps: BasicMemoryFsDeps,
): Promise<BasicMemoryRecallSource[]> {
	const files = await deps.listMarkdownFiles(rootDir);
	const sources: BasicMemoryRecallSource[] = [];
	for (const path of files) {
		let content: string;
		let updatedAt: number;
		try {
			[content, updatedAt] = await Promise.all([deps.readFile(path), deps.statMtimeMs(path)]);
		} catch {
			continue;
		}
		const id = readPermalink(content) ?? relativeNoteId(rootDir, path);
		const { title } = parseBasicMemoryNote({ id, content, updatedAt });
		sources.push({ permalink: id, title, body: stripFrontmatter(content) });
	}
	return sources;
}

/** The live node:fs implementation of {@link BasicMemoryFsDeps}. */
export function nodeBasicMemoryFsDeps(): BasicMemoryFsDeps {
	return {
		async listMarkdownFiles(rootDir: string): Promise<string[]> {
			const { readdir } = await import("node:fs/promises");
			const { join } = await import("node:path");
			type StringDirent = import("node:fs").Dirent<string>;
			const out: string[] = [];
			const walk = async (dir: string): Promise<void> => {
				let entries: StringDirent[];
				try {
					entries = (await readdir(dir, { withFileTypes: true, encoding: "utf8" })) as StringDirent[];
				} catch {
					return;
				}
				for (const entry of entries) {
					const full = join(dir, entry.name);
					if (entry.isDirectory()) {
						// Skip Basic Memory's internal/hidden dirs (`.basic-memory`, `.git`, etc.) — not user notes.
						if (entry.name.startsWith(".")) {
							continue;
						}
						await walk(full);
					} else if (entry.isFile() && /\.md$/i.test(entry.name)) {
						out.push(full);
					}
				}
			};
			await walk(rootDir);
			return out;
		},
		async readFile(path: string): Promise<string> {
			const { readFile } = await import("node:fs/promises");
			return readFile(path, "utf8");
		},
		async statMtimeMs(path: string): Promise<number> {
			const { stat } = await import("node:fs/promises");
			return (await stat(path)).mtimeMs;
		},
	};
}
