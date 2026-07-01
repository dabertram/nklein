/**
 * §5.B localization port — the READ-ONLY fault-localization contract the repair kernel's `localize` step depends on.
 * "Where does the fault live?" answered as structured hits (file · optional enclosing symbol · optional 1-based line
 * span · optional confidence), WITHOUT the ability to edit — the small-model phase-gating invariant (localization cannot
 * mutate; only generation edits). Defining the port + result type here, substrate-first, lets the eventual backing —
 * `codebase-memory-mcp` (evaluate FIRST, per todo §5.B) or a native code-index fallback — fill one stable contract, and
 * lets a rich provider drop into the kernel's existing `localize: () => Promise<readonly string[]>` via the adapter below
 * with no kernel change.
 */

/** One localized location — where the fault likely lives. Line spans are 1-based inclusive; symbol/lines/score optional. */
export interface LocalizationHit {
	/** Workspace-relative file path. */
	file: string;
	/** Enclosing symbol (function/class/etc.), when the provider can resolve it. */
	symbol?: string;
	/** 1-based inclusive start line, when known. */
	startLine?: number;
	/** 1-based inclusive end line, when known (defaults to `startLine` for a single line). */
	endLine?: number;
	/** Provider confidence in [0,1] for ranking/tiebreaks, when known. */
	score?: number;
	/** Short human reason ("import edge from the failing test", "symbol referenced in the stack trace"). */
	reason?: string;
}

/** Input to a localization query. */
export interface LocalizationQuery {
	/** The fault description / failing test / stack trace to localize from. */
	query: string;
	/** Cap on returned hits (the provider may return fewer). */
	maxHits?: number;
}

/**
 * Read-only fault localization (AST / symbol / import-edge / call-graph). CANNOT edit — enforced by the port shape (it
 * only returns locations). Backed later by `codebase-memory-mcp` or a native code-index provider.
 */
export interface LocalizationProvider {
	localize(query: LocalizationQuery): Promise<readonly LocalizationHit[]>;
}

/**
 * Compact `file[:symbol | :start-end]` ref for a hit — the string form the repair kernel's `localize` dep consumes.
 * Prefers the symbol (stable across edits); falls back to a line span, then the bare file.
 */
export function localizationHitToRef(hit: LocalizationHit): string {
	if (hit.symbol && hit.symbol.length > 0) {
		return `${hit.file}:${hit.symbol}`;
	}
	if (typeof hit.startLine === "number") {
		const end = typeof hit.endLine === "number" && hit.endLine !== hit.startLine ? `-${hit.endLine}` : "";
		return `${hit.file}:${hit.startLine}${end}`;
	}
	return hit.file;
}

/**
 * Order hits best-first: higher `score` first (hits without a score sort last), then by file + symbol for a stable,
 * deterministic order. Pure — does not mutate the input.
 */
export function rankLocalizationHits(hits: readonly LocalizationHit[]): LocalizationHit[] {
	return [...hits].sort((a, b) => {
		const sa = a.score ?? Number.NEGATIVE_INFINITY;
		const sb = b.score ?? Number.NEGATIVE_INFINITY;
		if (sa !== sb) {
			return sb - sa;
		}
		return (a.file + (a.symbol ?? "")).localeCompare(b.file + (b.symbol ?? ""));
	});
}

/**
 * Adapt a {@link LocalizationProvider} to the repair kernel's `localize: () => Promise<readonly string[]>` dep: run the
 * query, rank the hits, and flatten to de-duplicated `file[:symbol|:span]` refs. Lets a rich provider back the kernel
 * with no kernel change (§5.B "wired as the kernel's localize dep").
 */
export function localizationProviderAsKernelLocalize(
	provider: LocalizationProvider,
	query: LocalizationQuery,
): () => Promise<readonly string[]> {
	return async () => {
		const hits = await provider.localize(query);
		const refs = rankLocalizationHits(hits).map(localizationHitToRef);
		return [...new Set(refs)]; // de-dupe while preserving best-first order
	};
}
