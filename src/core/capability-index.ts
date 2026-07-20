/**
 * Capability index — extract each core module's PURPOSE so existing capability is findable. PURE core.
 *
 * ── WHY THIS EXISTS ──
 * In one session this project produced THREE near-duplications: F12.28 reimplemented F12.41's significance test
 * (with a weaker method), F12.82 was about to duplicate F12.28's optimizer, and P20.2/P20.5 were specified from
 * scratch when `diagnostic-oracles.ts` had implemented their verdict cores two weeks earlier.
 *
 * The common cause is not carelessness and it is not dead code — it is **discoverability**. A 119-module orphan
 * list reads as "too much unused code"; the accurate reading is **"a lot of built capability nobody can find"**.
 * Deleting it would destroy value; indexing it recovers value. This module does the second.
 *
 * The index is GENERATED from docblocks, because a hand-written one goes stale exactly when a new module lands —
 * which is the moment it would have prevented a duplication.
 */

export interface CapabilityEntry {
	readonly module: string;
	/** First substantive docblock sentence — what this module is FOR. */
	readonly purpose: string;
	/** Backlog labels found in the docblock (`§5.AQ`, `F12.35`), for tracing back to the deciding item. */
	readonly labels: readonly string[];
	readonly exports: readonly string[];
}

const LABEL_PATTERNS = [/§5\.[A-Z]{1,2}\b/g, /\b[FPNSW]\d+\.\d+[a-z]?\b/g];

/** Lines that are structure or noise rather than purpose. */
function isNoise(line: string): boolean {
	return (
		line.length < 25 ||
		line.startsWith("import ") ||
		line.startsWith("@") ||
		/^[-*=|]+$/.test(line) ||
		line.startsWith("──")
	);
}

/**
 * Extract a module's purpose from its leading docblock.
 *
 * Deliberately returns the FIRST substantive sentence rather than a summary: a summary would need a model, would
 * vary between runs, and would break the byte-stability that makes a generated doc reviewable in a diff.
 */
export function extractCapability(module: string, source: string): CapabilityEntry {
	const lines = source.split("\n");
	const docLines: string[] = [];
	for (const raw of lines.slice(0, 40)) {
		const line = raw.trim();
		if (line.startsWith("/**") || line === "*/" || line === "*") {
			continue;
		}
		if (line.startsWith("*")) {
			docLines.push(line.replace(/^\*\s?/, "").trim());
			continue;
		}
		if (docLines.length > 0) {
			break;
		}
	}
	const purposeLine = docLines.find((line) => !isNoise(line)) ?? "(no docblock)";
	// Trim to the first sentence so the index stays scannable; keep the whole line when it has no period.
	const firstSentence = purposeLine.split(/(?<=\.)\s/)[0] ?? purposeLine;

	const head = source.slice(0, 4000);
	const labels = new Set<string>();
	for (const pattern of LABEL_PATTERNS) {
		for (const match of head.match(pattern) ?? []) {
			labels.add(match);
		}
	}

	const exports: string[] = [];
	for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
		if (match[1]) {
			exports.push(match[1]);
		}
	}

	return {
		module,
		purpose: firstSentence.slice(0, 220),
		labels: [...labels].sort(),
		exports,
	};
}

/**
 * Find entries whose purpose or exports match a query. Substring, case-insensitive, deliberately dumb — the
 * point is to answer "does something already do X?" before writing X, and a fuzzy matcher that misses is worse
 * than a literal one that over-returns.
 */
export function searchCapabilities(entries: readonly CapabilityEntry[], query: string): CapabilityEntry[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) {
		return [];
	}
	return entries.filter((entry) => {
		const haystack = `${entry.module} ${entry.purpose} ${entry.exports.join(" ")}`.toLowerCase();
		return haystack.includes(needle);
	});
}
