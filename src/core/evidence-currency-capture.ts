/**
 * F4.3 producer substrate — turn a retrieved web source into a {@link CurrencyEvidence} so
 * {@link summarizeEvidenceCurrency} can judge "is this current?". The genuinely-missing capability is a publication-DATE
 * parser (the web-research fetch never extracted one, so `sourceDateMs` was always null); trust is DERIVED from the URL
 * via {@link scoreSourceTrust} (no new policy). `supports`/`conflicts` are subjective judgments this seam doesn't make —
 * a cited source defaults to `supports: true` with no conflicts, left for a richer analyzer rather than guessed.
 *
 * Pure + deterministic (clock/parse only, no I/O) → fully unit-testable. The effectful capture (call this in the
 * web-research fetch where the raw HTML lives, persist the result) + the output annotation are the remaining activation.
 */

import type { CurrencyEvidence, EvidenceTrust } from "./evidence-currency-status.js";
import { type SourceTrustTier, scoreSourceTrust } from "./retrieval-source-trust.js";

/** Map the retrieval-source-trust tier onto the coarser evidence-currency trust enum (authoritative ⇒ high, etc.). */
export function evidenceTrustFromTier(tier: SourceTrustTier): EvidenceTrust {
	switch (tier) {
		case "authoritative":
			return "high";
		case "reputable":
			return "high";
		case "community":
			return "medium";
		case "low":
			return "low";
		default:
			return "unknown";
	}
}

/** Trust tier for a retrieved source, derived from its URL/domain alone (no I/O). */
export function evidenceTrustFromRef(ref: string): EvidenceTrust {
	return evidenceTrustFromTier(scoreSourceTrust(ref).tier);
}

// Ordered most-specific → least: an explicit article-published meta wins over a generic date, which wins over <time>.
const DATE_PATTERNS: readonly RegExp[] = [
	/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
	/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
	/"datePublished"\s*:\s*"([^"]+)"/i,
	/<meta[^>]+name=["'](?:date|dc\.date|publishdate|pubdate)["'][^>]+content=["']([^"']+)["']/i,
	/<time[^>]+datetime=["']([^"']+)["']/i,
];

/**
 * Best-effort publication date (ms epoch) from a page's raw HTML — reads the conventional metadata signals
 * (article:published_time, JSON-LD datePublished, a date meta, or a <time datetime>). Returns null when none is present
 * or parseable (an undated source stays honestly undated — never a fabricated "now").
 */
export function extractPublicationDate(html: string, parse: (value: string) => number = Date.parse): number | null {
	for (const pattern of DATE_PATTERNS) {
		const match = html.match(pattern);
		const raw = match?.[1]?.trim();
		if (!raw) {
			continue;
		}
		const ms = parse(raw);
		if (Number.isFinite(ms)) {
			return ms;
		}
	}
	return null;
}

/**
 * Compose a {@link CurrencyEvidence} from a retrieved source: date parsed from the HTML, trust derived from the URL,
 * `supports` defaulting to true (the model cited it) and no declared conflicts. Pure over its injected `parse` clock.
 */
export function buildCurrencyEvidenceFromSource(input: {
	id: string;
	ref: string;
	html: string;
	supports?: boolean;
	conflictsWithIds?: readonly string[];
	parse?: (value: string) => number;
}): CurrencyEvidence {
	return {
		id: input.id,
		sourceDateMs: extractPublicationDate(input.html, input.parse),
		trust: evidenceTrustFromRef(input.ref),
		supports: input.supports ?? true,
		conflictsWithIds: input.conflictsWithIds ?? [],
	};
}
