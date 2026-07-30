/**
 * P23.7 — PROGRESSIVE DISCLOSURE for a specification too large to read. PURE core.
 *
 * ── THE PROBLEM, MEASURED ──
 * `dev-test-projects/36`'s specification is **25,059 words / 192 KB** and opens by instructing the agent to *"read
 * the entire specification before planning"*. Against !Klein's ≥32k context floor that leaves nothing for system
 * instructions, repo evidence, reasoning, or the plan itself. The instruction and the budget are incompatible, and
 * an architect that obeys it has already lost.
 *
 * ── WHY AN INDEX AND NOT A REWRITE ──
 * The obvious move is to split the document. But that spec is a TEST FIXTURE whose size is deliberately part of
 * what it measures ("this specification is itself a context benchmark", recorded in the spec). Restructuring it
 * would change the test rather than pass it. An index is additive: the fixture stays exactly as it is, and the
 * agent gains a way to retrieve sections instead of swallowing the document.
 *
 * ── WHY NOT A REQUIREMENT INDEX (the thing P23.7 actually asked for first) ──
 * P23.7 wants a "machine-readable requirement index with stable IDs". **That cannot be derived from this
 * document: it contains ZERO RFC-2119 keywords** — not one MUST, SHALL, SHOULD or MAY across 25k words — so there
 * is no mechanical way to tell a requirement from a paragraph of rationale. A keyword extractor would return an
 * empty index and look like it worked. The requirement spine therefore has to be AUTHORED, not extracted, and
 * this module deliberately does not pretend otherwise. What it can do honestly is make the document navigable.
 *
 * ── ID STABILITY ──
 * Section ids combine the heading PATH with a short hash of the heading text. Neither alone is enough: paths
 * collide (two sections called "Overview" under different parents), and a pure content hash changes when a typo
 * is fixed. The pairing survives edits elsewhere in the document, which is the property that makes an id worth
 * citing in a plan or a card.
 */

import { createHash } from "node:crypto";

export interface SpecSection {
	/** Stable id: slugified heading path + a short hash of the heading text. */
	readonly id: string;
	readonly heading: string;
	/** Heading ancestry, outermost first, including this heading. */
	readonly path: readonly string[];
	/** Markdown heading level (1 = `#`). */
	readonly level: number;
	/** Words in this section's own body, EXCLUDING nested subsections. */
	readonly ownWords: number;
	/** Words in this section plus everything nested under it — what reading it "whole" actually costs. */
	readonly totalWords: number;
	/** Line where the heading appears (1-indexed), so a caller can slice the source. */
	readonly startLine: number;
	readonly endLine: number;
}

export interface SpecSectionIndex {
	readonly sections: readonly SpecSection[];
	readonly totalWords: number;
	readonly summary: string;
}

function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-+|-+$/gu, "")
			.slice(0, 40) || "section"
	);
}

function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

/** Build a navigable index of a markdown specification. Pure; the document is never modified. */
export function buildSpecSectionIndex(markdown: string): SpecSectionIndex {
	const lines = markdown.split("\n");
	interface Open {
		heading: string;
		level: number;
		path: string[];
		startLine: number;
		bodyLines: string[];
	}
	const open: Open[] = [];
	const finished: (Open & { endLine: number; totalWords: number })[] = [];
	let inFence = false;

	const close = (level: number, endLine: number): void => {
		while (open.length > 0 && (open[open.length - 1] as Open).level >= level) {
			const section = open.pop() as Open;
			finished.push({ ...section, endLine, totalWords: 0 });
		}
	};

	for (const [index, rawLine] of lines.entries()) {
		// A `#` inside a fenced block is code, not a heading. Without this the index invents sections from shell
		// comments and markdown examples — and this document is full of both.
		if (/^\s*```/u.test(rawLine)) {
			inFence = !inFence;
		}
		const headingMatch = inFence ? null : /^(#{1,6})\s+(.*\S)\s*$/u.exec(rawLine);
		if (!headingMatch) {
			if (open.length > 0) {
				(open[open.length - 1] as Open).bodyLines.push(rawLine);
			}
			continue;
		}
		const level = (headingMatch[1] as string).length;
		const heading = headingMatch[2] as string;
		close(level, index);
		const path = [...open.map((entry) => entry.heading), heading];
		open.push({ heading, level, path, startLine: index + 1, bodyLines: [] });
	}
	close(0, lines.length);

	// `finished` came off a stack, so it is inner-first. Restore document order before computing totals.
	const ordered = finished.sort((left, right) => left.startLine - right.startLine);
	const sections: SpecSection[] = ordered.map((section) => {
		const ownWords = countWords(section.bodyLines.join("\n"));
		// A section's TOTAL is its own body plus every section nested inside its line span — the honest answer to
		// "what does reading this section cost me?", which is the number a retrieval budget has to work with.
		const totalWords = ordered
			.filter((other) => other.startLine >= section.startLine && other.endLine <= section.endLine)
			.reduce((sum, other) => sum + countWords(other.bodyLines.join("\n")), 0);
		return {
			id: `${slugify(section.path.join("/"))}-${createHash("sha256").update(section.heading).digest("hex").slice(0, 6)}`,
			heading: section.heading,
			path: section.path,
			level: section.level,
			ownWords,
			totalWords,
			startLine: section.startLine,
			endLine: section.endLine,
		};
	});

	const totalWords = sections.filter((section) => section.level === 1).reduce((sum, s) => sum + s.totalWords, 0);
	return {
		sections,
		totalWords: totalWords || sections.reduce((sum, s) => sum + s.ownWords, 0),
		summary: `${sections.length} section(s), ${sections.reduce((sum, s) => sum + s.ownWords, 0)} word(s).`,
	};
}

export interface SpecRetrievalPlan {
	readonly included: readonly SpecSection[];
	readonly deferred: readonly SpecSection[];
	readonly includedWords: number;
	readonly summary: string;
}

/**
 * Choose which sections fit a word budget, in document order.
 *
 * Document order rather than a relevance ranking: this module has no task to rank against, and inventing a
 * relevance score with nothing to score it on is how a retrieval layer starts quietly dropping the section that
 * mattered. A caller WITH a task should filter first and pass the survivors here.
 *
 * Sections whose OWN body exceeds the whole budget are still deferred rather than truncated — half a requirement
 * is worse than a pointer to the whole one, because the half reads as complete.
 */
export function planSpecRetrieval(index: SpecSectionIndex, budgetWords: number): SpecRetrievalPlan {
	const included: SpecSection[] = [];
	const deferred: SpecSection[] = [];
	let used = 0;
	for (const section of index.sections) {
		if (used + section.ownWords <= budgetWords) {
			included.push(section);
			used += section.ownWords;
		} else {
			deferred.push(section);
		}
	}
	return {
		included,
		deferred,
		includedWords: used,
		summary:
			deferred.length === 0
				? `all ${included.length} section(s) fit in ${budgetWords} words`
				: `${included.length} section(s) (${used} words) fit; ${deferred.length} DEFERRED — retrieve them by id when needed`,
	};
}
