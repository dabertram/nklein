import { statSync } from "node:fs";
import { join } from "node:path";
import {
	buildRankedCorpusProvenance,
	KLEIN_CORPUS_SOURCE_PATH,
	type KleinCorpusProvenance,
} from "../core/klein-self-corpus-provenance";
import {
	type KleinCorpusDoc,
	type KleinSelfCorpusRoute,
	routeKleinSelfCorpus,
} from "../core/klein-self-corpus-routing";
import { runGit } from "../workspace/git-utils";

/**
 * F2.19b + F2.20b — the `klein_self` corpus PRODUCER at the self-scope answer seam.
 *
 * The read-only `klein_self` chat scope answers questions about !Klein itself from its own planning corpus
 * (done/todo/AGENTS/CHANGELOG/docs). The §5.AH-A routing core (`routeKleinSelfCorpus`) decides WHICH docs are the
 * authority for a question, and the F2.19 provenance core (`buildRankedCorpusProvenance`) decides how to CITE each
 * with real freshness. This module joins them into the leading system note the chat turn injects, so the model
 * grounds its answer in CURRENT source — read via the read tools already in the klein_self bundle — instead of
 * leaning on remembered prose that may lag the live repo.
 *
 * We inject CITATIONS + a read directive, NOT the raw doc bodies: done.md/todo.md are huge, and the scope already
 * has read tools, so dumping the files would blow the context floor while adding nothing the model can't fetch.
 * The pure renderer is separated from the effectful freshness read so the note text stays fully unit-testable.
 */

/** A one-line description of each corpus doc's authority, shown beside its citation in the note. */
const KLEIN_CORPUS_DESCRIPTION: Record<KleinCorpusDoc, string> = {
	done: "shipped-feature catalog (what exists)",
	todo: "backlog + what's left, with rationale (planned / known issues)",
	agents: "working mode, conventions, tribal knowledge",
	changelog: "user-facing release history (what shipped when)",
	docs: "current maintained architecture/reference docs",
};

/** Per-doc freshness as read from the repo: last-modified epoch ms (null = unknown) + optional git short-sha. */
export interface KleinCorpusDocFreshness {
	lastModifiedMs: number | null;
	commitSha: string | null;
}

/** Reads one corpus doc's freshness from the repo. Injected so the note builder stays testable without a real repo. */
export type KleinCorpusFreshnessReader = (doc: KleinCorpusDoc, relPath: string) => Promise<KleinCorpusDocFreshness>;

/**
 * Render the leading system note from a route + its docs' provenance. Pure. Returns null when the route has no
 * available doc to ground on (so the caller injects nothing rather than an empty directive).
 */
export function renderKleinSelfCorpusNote(
	route: KleinSelfCorpusRoute,
	provenance: readonly KleinCorpusProvenance[],
): string | null {
	if (provenance.length === 0) {
		return null;
	}
	const lines = provenance.map(
		(entry, index) => `${index + 1}. ${entry.citation} — ${KLEIN_CORPUS_DESCRIPTION[entry.doc]}`,
	);
	return [
		"You are answering a question about !Klein itself, grounded in its own source. READ the current source of these",
		"documents with your read tools rather than relying on remembered prose, and cite the file (and its freshness) in",
		"your answer. A doc marked “may be stale” still lives in the repo — read it; the marker only warns its content",
		"may lag the live source.",
		"",
		"Most relevant for this question first:",
		...lines,
		"",
		`Routing: ${route.rationale}`,
	].join("\n");
}

/**
 * Build the `klein_self` corpus note for a question: route it, read each ranked doc's real freshness, stamp
 * provenance, and render the note. Returns null when there is no repo root (a packaged install without the source)
 * or the route yields no available doc. The freshness reader is injected (the git-backed default is
 * {@link readKleinCorpusFreshnessFromGit}).
 */
export async function buildKleinSelfCorpusNote(
	question: string,
	deps: {
		now: number;
		repoRoot: string | null;
		readDocFreshness: KleinCorpusFreshnessReader;
		availableDocs?: readonly KleinCorpusDoc[];
		stalenessThresholdMs?: number;
	},
): Promise<string | null> {
	if (!deps.repoRoot) {
		return null;
	}
	const route = routeKleinSelfCorpus(question, deps.availableDocs ? { availableDocs: deps.availableDocs } : undefined);
	if (route.ranked.length === 0) {
		return null;
	}
	const freshnessInputs = await Promise.all(
		route.ranked.map(async (doc) => {
			const freshness = await deps.readDocFreshness(doc, KLEIN_CORPUS_SOURCE_PATH[doc]);
			return { doc, lastModifiedMs: freshness.lastModifiedMs, commitSha: freshness.commitSha };
		}),
	);
	const provenance = buildRankedCorpusProvenance(freshnessInputs, {
		now: deps.now,
		...(typeof deps.stalenessThresholdMs === "number" ? { stalenessThresholdMs: deps.stalenessThresholdMs } : {}),
	});
	return renderKleinSelfCorpusNote(route, provenance);
}

/**
 * The git-backed freshness reader: the last commit touching a doc gives both its short-sha and its commit time
 * (authoritative provenance). Falls back to the filesystem mtime when git has no record (untracked/shallow), then
 * to unknown (null) — which the provenance core treats as cautiously stale. Never throws.
 */
export function readKleinCorpusFreshnessFromGit(repoRoot: string): KleinCorpusFreshnessReader {
	return async (_doc, relPath) => {
		// %h + a space + %cI (committer date, ISO-8601): the short-sha is hex and the date has no space, so a single
		// space split is unambiguous — and avoids a NUL separator (which would make tooling treat output as binary).
		const result = await runGit(repoRoot, ["log", "-1", "--format=%h %cI", "--", relPath]);
		if (result.ok && result.stdout) {
			const firstSpace = result.stdout.indexOf(" ");
			if (firstSpace > 0) {
				const commitSha = result.stdout.slice(0, firstSpace);
				const parsed = Date.parse(result.stdout.slice(firstSpace + 1).trim());
				if (Number.isFinite(parsed)) {
					return { lastModifiedMs: parsed, commitSha };
				}
			}
		}
		try {
			return { lastModifiedMs: statSync(join(repoRoot, relPath)).mtimeMs, commitSha: null };
		} catch {
			return { lastModifiedMs: null, commitSha: null };
		}
	};
}
