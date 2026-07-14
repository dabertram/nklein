/**
 * F5.2 (pure core, effectful-reader companion) — parse ONE raw basic-memory markdown note into the
 * {@link AuditableMemoryNote} shape the freshness audit consumes. Basic Memory stores plain Markdown on disk
 * (`~/basic-memory/**​/*.md`): a YAML frontmatter block (`title:`, `permalink:`) followed by a body that may carry
 * `[[wikilink]]` references. The effectful b-leaf lists + reads + stats the files; this turns each (content, id,
 * mtime) triple into a note WITHOUT a YAML dependency or a clock — so it stays pure, total, and unit-testable.
 *
 * Resolution rules (deliberately forgiving — a hygiene audit must never crash on a hand-edited note):
 *  - id       — caller-supplied stable identity (the frontmatter `permalink` when present, else the relative path).
 *  - title    — frontmatter `title:`, else the first ATX `#` heading, else the id (never empty).
 *  - links    — every `[[target]]` in the BODY (frontmatter excluded), alias (`|`) and section (`#`) stripped, deduped.
 */

import type { AuditableMemoryNote } from "./memory-freshness-audit.js";

export interface ParseBasicMemoryNoteInput {
	/** Stable identity for this note — the frontmatter permalink when known, else its repo-relative path. */
	readonly id: string;
	/** Raw file contents. */
	readonly content: string;
	/** Last-modified time (ms epoch) — taken from the file stat by the effectful reader. */
	readonly updatedAt: number;
}

interface SplitNote {
	/** The raw frontmatter block body (between the `---` fences), or null when there is no frontmatter. */
	readonly frontmatter: string | null;
	/** Everything after the frontmatter block (the whole content when there is no frontmatter). */
	readonly body: string;
}

/**
 * Split leading YAML frontmatter from the body. Frontmatter must start on line 1 with `---` and end at the next
 * `---` line; anything else is treated as an all-body note (no throw on a malformed/unterminated fence).
 */
function splitFrontmatter(content: string): SplitNote {
	// Normalize CRLF so a Windows-authored note parses identically.
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return { frontmatter: null, body: normalized };
	}
	const closeIndex = normalized.indexOf("\n---", 3);
	if (closeIndex === -1) {
		// Unterminated fence — don't swallow the whole file as frontmatter; treat it all as body.
		return { frontmatter: null, body: normalized };
	}
	const frontmatter = normalized.slice(4, closeIndex);
	// Body starts after the closing fence line (skip the `\n---` and the rest of that line).
	const afterClose = normalized.indexOf("\n", closeIndex + 1);
	const body = afterClose === -1 ? "" : normalized.slice(afterClose + 1);
	return { frontmatter, body };
}

/** Read a top-level scalar (`key: value`) from a frontmatter block. Returns the trimmed, unquoted value or null. */
function readFrontmatterScalar(frontmatter: string, key: string): string | null {
	for (const line of frontmatter.split("\n")) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (match && match[1] === key) {
			const raw = match[2].trim();
			if (raw === "") {
				return null;
			}
			// Strip a single pair of wrapping quotes if present.
			const unquoted = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
			return unquoted.length > 0 ? unquoted : null;
		}
	}
	return null;
}

/** First ATX heading (`# Foo`) text in a body, or null. */
function firstHeading(body: string): string | null {
	for (const line of body.split("\n")) {
		const match = line.match(/^#{1,6}\s+(.*\S)\s*$/);
		if (match) {
			return match[1].trim();
		}
	}
	return null;
}

/**
 * Extract deduped `[[wikilink]]` targets from a body. An alias (`[[target|shown]]`) keeps `target`; a section anchor
 * (`[[target#heading]]`) keeps `target`. Empty targets are ignored. Order preserved (first occurrence wins).
 */
function extractWikiLinks(body: string): string[] {
	const seen = new Set<string>();
	const links: string[] = [];
	const pattern = /\[\[([^\]]+)\]\]/g;
	for (const match of body.matchAll(pattern)) {
		const inner = match[1];
		// Alias pipe and section anchor both delimit the trailing display/section — the link target is what precedes.
		const target = inner.split("|")[0].split("#")[0].trim();
		if (target === "") {
			continue;
		}
		const key = target.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			links.push(target);
		}
	}
	return links;
}

/** Parse one raw basic-memory markdown note into the audit's {@link AuditableMemoryNote}. Pure + total. */
export function parseBasicMemoryNote(input: ParseBasicMemoryNoteInput): AuditableMemoryNote {
	const { frontmatter, body } = splitFrontmatter(input.content);
	const frontmatterTitle = frontmatter ? readFrontmatterScalar(frontmatter, "title") : null;
	const title = frontmatterTitle ?? firstHeading(body) ?? input.id;
	return {
		id: input.id,
		title,
		updatedAt: input.updatedAt,
		links: extractWikiLinks(body),
	};
}
