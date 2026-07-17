/**
 * F12.10 structured tool-output parsing channel (DRIFT-style) — PURE core.
 *
 * Beyond the S4 screen (flag) and S2 fence (label), the 2026 SOTA adds a stronger discipline for the riskiest
 * ingestions: PARSE the untrusted output into a strict typed shape and drop everything that doesn't fit — injection
 * payloads included, because an attack string is by construction not a well-formed fact/url/title field. This is the
 * deterministic variant (no model in the loop): each candidate unit must individually pass the S4 screen CLEAN to be
 * retained, hard caps bound the shape, and the result reports what was dropped so the reduction is auditable, never
 * silent. Pure + deterministic; the ingestion seam decides raw-vs-parsed (opt-in flag, default off).
 */

import { screenUntrustedContent } from "./untrusted-content-prescreen";

export interface ParsedWebContent {
	/** Title line, screened; null when the raw title was flagged or absent. */
	readonly title: string | null;
	/** Individually-screened sentences, in order, capped — the FACTS channel. */
	readonly facts: readonly string[];
	/** HTTPS URLs found in the content (the caller applies its allow-list); capped. */
	readonly urls: readonly string[];
	/** Units dropped by the screen or the caps — the honesty counter (dropped > 0 is common and fine). */
	readonly droppedUnits: number;
	/** One-line provenance note for the consuming prompt. */
	readonly note: string;
}

export interface StructuredParseOptions {
	readonly maxFacts?: number;
	readonly maxUrls?: number;
	/** Max chars per retained fact (longer units are dropped, not truncated — truncation can un-flag a payload). */
	readonly maxFactLength?: number;
}

const DEFAULT_MAX_FACTS = 40;
const DEFAULT_MAX_URLS = 10;
const DEFAULT_MAX_FACT_LENGTH = 400;

/**
 * Parse untrusted web/tool text into the strict typed shape. Retention rule per unit: individually S4-clean AND
 * within the length cap. Everything else is dropped and counted. Deterministic: same input, same shape.
 */
export function parseUntrustedWebContent(
	raw: { title: string | null; content: string },
	options: StructuredParseOptions = {},
): ParsedWebContent {
	const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;
	const maxUrls = options.maxUrls ?? DEFAULT_MAX_URLS;
	const maxFactLength = options.maxFactLength ?? DEFAULT_MAX_FACT_LENGTH;
	let dropped = 0;

	const title =
		raw.title && raw.title.length <= maxFactLength && screenUntrustedContent(raw.title).verdict === "clean"
			? raw.title
			: null;
	if (raw.title && title === null) {
		dropped += 1;
	}

	// URLs first (they survive independent of sentence retention); https only — plain http never re-enters.
	const urls: string[] = [];
	for (const match of raw.content.matchAll(/https:\/\/[^\s<>"')]+/g)) {
		if (urls.length >= maxUrls) {
			dropped += 1;
			continue;
		}
		if (!urls.includes(match[0])) {
			urls.push(match[0]);
		}
	}

	// Sentence-split the content; retain only units that individually screen clean.
	const units = raw.content
		.split(/(?<=[.!?])\s+|\n+/)
		.map((unit) => unit.trim())
		.filter((unit) => unit.length > 0);
	const facts: string[] = [];
	for (const unit of units) {
		if (facts.length >= maxFacts) {
			dropped += 1;
			continue;
		}
		if (unit.length > maxFactLength || screenUntrustedContent(unit).verdict !== "clean") {
			dropped += 1;
			continue;
		}
		facts.push(unit);
	}

	return {
		title,
		facts,
		urls,
		droppedUnits: dropped,
		note: `Structured ingestion (F12.10): ${facts.length} fact(s) + ${urls.length} url(s) retained, ${dropped} unit(s) dropped by the screen/caps.`,
	};
}

/** Render the parsed shape back to prompt text — the ONLY form that re-enters orchestration when the channel is on. */
export function renderParsedWebContent(parsed: ParsedWebContent): string {
	const lines: string[] = [];
	if (parsed.title) {
		lines.push(`Title: ${parsed.title}`);
	}
	lines.push(...parsed.facts);
	if (parsed.urls.length > 0) {
		lines.push(`Links: ${parsed.urls.join(" ")}`);
	}
	lines.push(`[${parsed.note}]`);
	return lines.join("\n");
}
