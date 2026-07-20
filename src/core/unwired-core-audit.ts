/**
 * P15.1 (mechanism registry, generated half) — find exported core functions with NO non-test consumer. PURE core.
 *
 * The charter accepts the criticism that mechanisms have outrun proof. The cheapest mechanical signal for that is
 * an exported function nothing calls: a core that shipped, passed its tests, and was never wired to anything.
 *
 * Found by hand on 2026-07-20 and immediately productive: `cache-stable-prefix-order.ts` had **zero** consumers
 * across all three exports while three backlog items described "the cache-stable-prefix assembler" as if it ran
 * in the prompt path. **Anyone reasoning from those sentences was reasoning about code that never executes.**
 * That is the class of drift this audit exists to surface, and doing it by hand does not scale past one lucky
 * read.
 *
 * ── WHAT THIS IS NOT ──
 * An orphan is NOT automatically dead code, and this module deliberately does not say "delete". Legitimate
 * orphans include: a core built ahead of a wire that is still coming, a deliberate public API, and a core whose
 * lesson was the POINT (the charter's own standard is learning value, not consumer count). So the output is a
 * QUESTION LIST for a human, ranked by how long the orphan has existed — not a verdict.
 *
 * Honesty stance: this is a text-level scan, not a type-aware one. It can miss a call made through a re-export or
 * a dynamic lookup, so a reported orphan is a PROMPT TO CHECK, never proof of absence. Under-claiming here is
 * cheap; a false "this is dead, delete it" is not.
 */

export interface ExportedSymbol {
	readonly module: string;
	readonly name: string;
}

export interface OrphanFinding extends ExportedSymbol {
	/** Non-test references outside the symbol's own module. Zero is the smell. */
	readonly consumers: number;
	/** References that look like docblock/comment mentions rather than calls — the trap found on 2026-07-20. */
	readonly commentOnlyMentions: number;
}

/** Extract exported function/const names from a TypeScript source. Text-level by design; see the docblock. */
export function extractExportedSymbols(module: string, source: string): ExportedSymbol[] {
	const names = new Set<string>();
	for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
		if (match[1]) {
			names.add(match[1]);
		}
	}
	for (const match of source.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/gm)) {
		if (match[1]) {
			names.add(match[1]);
		}
	}
	return [...names].map((name) => ({ module, name }));
}

/**
 * Classify one reference line as a real usage or a comment mention.
 *
 * This distinction is the whole reason the hand audit nearly went wrong: `context-smart-zone`'s two "consumers"
 * were both docblock references, so a naive grep count of 2 would have reported it as WIRED when nothing calls it.
 */
export function isCommentMention(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
}

export interface AuditInput {
	readonly symbols: readonly ExportedSymbol[];
	/**
	 * Every non-test source line that mentions a symbol, keyed `module::name`. The caller does the file walking;
	 * this module does the judging, so the decision logic stays testable without a filesystem.
	 */
	readonly referenceLines: ReadonlyMap<string, readonly string[]>;
}

export interface AuditResult {
	readonly orphans: readonly OrphanFinding[];
	/** Symbols whose only references are comment mentions — the subtlest and most misleading case. */
	readonly commentOnlyOrphans: readonly OrphanFinding[];
	readonly totalScanned: number;
	readonly summary: string;
}

/** Judge which exported symbols have no real consumer. */
export function auditUnwiredCores(input: AuditInput): AuditResult {
	const orphans: OrphanFinding[] = [];
	const commentOnly: OrphanFinding[] = [];

	for (const symbol of input.symbols) {
		const lines = input.referenceLines.get(`${symbol.module}::${symbol.name}`) ?? [];
		const comments = lines.filter(isCommentMention).length;
		const real = lines.length - comments;
		const finding: OrphanFinding = { ...symbol, consumers: real, commentOnlyMentions: comments };
		if (real === 0) {
			orphans.push(finding);
			if (comments > 0) {
				commentOnly.push(finding);
			}
		}
	}

	const summary =
		orphans.length === 0
			? `All ${input.symbols.length} exported core symbol(s) have at least one non-test consumer.`
			: [
					`${orphans.length} of ${input.symbols.length} exported core symbol(s) have NO non-test consumer.`,
					commentOnly.length > 0
						? `${commentOnly.length} of those are referenced ONLY from comments — a naive grep would report them as wired.`
						: "",
					"An orphan is a QUESTION, not a verdict: it may be a core built ahead of its wire, a deliberate public API, or a core whose lesson was the point. This scan is text-level and can miss re-exports or dynamic lookups.",
				]
					.filter((part) => part.length > 0)
					.join(" ");

	return { orphans, commentOnlyOrphans: commentOnly, totalScanned: input.symbols.length, summary };
}
