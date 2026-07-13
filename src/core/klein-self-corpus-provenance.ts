import type { KleinCorpusDoc } from "./klein-self-corpus-routing.js";

/**
 * F2.19 — freshness + provenance for the read-only !Klein self-awareness corpus. `routeKleinSelfCorpus` decides
 * WHICH doc answers a "how does !Klein work?" question; this decides how to CITE it: the exact source path, how
 * fresh the content is, and a stale flag so a self-scope answer grounds in CURRENT source instead of leaning on
 * stale prompt prose (the §6.11-A / F2.20 intent). Pure + clock-injected; the caller supplies each doc's
 * last-modified time (and optional git short-sha) from a stat/git read.
 */

/** The canonical source path for each corpus doc (repo-relative). `docs` points at the maintained docs tree. */
export const KLEIN_CORPUS_SOURCE_PATH: Record<KleinCorpusDoc, string> = {
	done: "done.md",
	todo: "todo.md",
	agents: "AGENTS.md",
	changelog: "CHANGELOG.md",
	docs: "docs/",
};

/** Content older than this reads as STALE — worth flagging that it may lag the live source. Default 14 days. */
export const DEFAULT_CORPUS_STALENESS_MS = 14 * 24 * 60 * 60 * 1000;

export interface KleinCorpusDocFreshnessInput {
	doc: KleinCorpusDoc;
	/** The doc's last-modified time (epoch ms), from a filesystem stat or the latest commit touching it. */
	lastModifiedMs: number | null;
	/** Optional git short-sha of the commit that last touched the doc (provenance anchor). */
	commitSha?: string | null;
}

export interface KleinCorpusProvenance {
	doc: KleinCorpusDoc;
	path: string;
	lastModifiedMs: number | null;
	/** now − lastModifiedMs, or null when the doc's time is unknown. */
	ageMs: number | null;
	/** True when older than the staleness threshold (or unknown time — unknown fails to the cautious "stale"). */
	stale: boolean;
	commitSha: string | null;
	/** A one-line citation an answer surfaces so the operator sees the source + its freshness. */
	citation: string;
}

function formatAge(ageMs: number): string {
	const minutes = Math.round(ageMs / 60_000);
	if (minutes < 60) {
		return `${Math.max(1, minutes)}m ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 48) {
		return `${hours}h ago`;
	}
	return `${Math.round(hours / 24)}d ago`;
}

/**
 * Build the provenance/freshness record for one corpus doc. Unknown last-modified time is treated as STALE
 * (cautious: an answer should warn when it can't prove freshness). The citation names the path, the age, a
 * `(stale)` marker when applicable, and the commit sha when supplied.
 */
export function buildKleinCorpusProvenance(
	input: KleinCorpusDocFreshnessInput,
	options: { now: number; stalenessThresholdMs?: number },
): KleinCorpusProvenance {
	const path = KLEIN_CORPUS_SOURCE_PATH[input.doc];
	const threshold = Math.max(0, options.stalenessThresholdMs ?? DEFAULT_CORPUS_STALENESS_MS);
	const ageMs = input.lastModifiedMs === null ? null : Math.max(0, options.now - input.lastModifiedMs);
	const stale = ageMs === null || ageMs > threshold;
	const commitSha = input.commitSha?.trim() || null;
	const freshnessLabel = ageMs === null ? "freshness unknown" : formatAge(ageMs);
	const staleMark = stale ? " — may be stale" : "";
	const commitMark = commitSha ? `, commit ${commitSha}` : "";
	const citation = `${path} (updated ${freshnessLabel}${commitMark})${staleMark}`;
	return { doc: input.doc, path, lastModifiedMs: input.lastModifiedMs, ageMs, stale, commitSha, citation };
}

/** Build provenance for a ranked doc list (the route's `ranked`), most-relevant first. */
export function buildRankedCorpusProvenance(
	docs: readonly KleinCorpusDocFreshnessInput[],
	options: { now: number; stalenessThresholdMs?: number },
): KleinCorpusProvenance[] {
	return docs.map((doc) => buildKleinCorpusProvenance(doc, options));
}
