import { isHomeAgentSessionId } from "./home-agent-session";

/**
 * §5.AQ strategies (a)+(d)+(b) — CACHE-WARMTH-AWARE routing (session stickiness, session-kind batching, context
 * rails) as a margin-bounded PREFERENCE in model selection. Pure core: prompt-shell identity + the warmth-aware
 * re-ranking, mirroring `applyDiversityPreference` (model-diversity.ts) exactly — a preference within a bounded
 * margin, never a correctness override, with the decision surfaced for observability.
 *
 * WHY the shell key is (sessionKind, workspacePath, modelId): every viable local backend (llama.cpp `cache_prompt`,
 * MLX prompt cache) reuses KV only for an EXACT contiguous byte/token prefix (docs/dev/prompt-cache-research-
 * 2026-07-02.md). Since the §5.AQ(e) shell restructure, two session starts with the SAME kind+workspace+model share
 * ~99% of their system-prompt bytes (only the per-task `session-env` trailer diverges); different session KINDS on
 * the same model+workspace still share ~74% (the static shell + config rules); different WORKSPACES share only the
 * static template. So the last shell a model prefilled is a deterministic warmth signal the orchestrator can track
 * without probing the server ("we know every prompt we send").
 *
 * CONTRACTS (fail-open, tiebreaker-only):
 * - DIVERSITY FIRST: for DECISION roles (reviewer/critic/judge) callers apply `applyDiversityPreference` FIRST and
 *   its result is AUTHORITATIVE — warmth may only re-order candidates diversity already allows (a diverse decision
 *   turn is a legitimate cache miss; rails must never silently sacrifice §5.AB diversity).
 * - MARGIN-BOUNDED: a warmer candidate is promoted over a colder higher-scored one only within `marginPoints` of
 *   the top candidate (hot = full margin, warm = half margin) — warmth never forces a badly unfit model.
 * - STALE = COLD: warmth older than `staleAfterMs` counts cold — the server may have evicted the slot/cache (LRU,
 *   interleaved traffic, model reload) and a stale claim would mis-route with false confidence.
 */

/** The session kinds that produce distinct prompt shells (each assembles a different post-shell fragment mix). */
export type PromptSessionKind = "worker" | "review" | "plan-critique" | "merge" | "architect" | "chat";

/** NUL never appears in session kinds, workspace paths, or model ids, so the joined key is collision-free. */
const SHELL_KEY_SEPARATOR = "\u0000";

export interface PromptShellIdentity {
	sessionKind: PromptSessionKind;
	/** The HOST workspace root the session runs against (same value at record and lookup seams). */
	workspacePath: string;
	/** The launch/served model id — the id the warmth ledger is keyed by. */
	modelId: string;
}

/** The identity of a prompt shell: sessions with the same key share ~99% of their prompt bytes (see module doc). */
export function buildPromptShellKey(input: PromptShellIdentity): string {
	return [input.sessionKind, input.workspacePath, input.modelId].join(SHELL_KEY_SEPARATOR);
}

/**
 * Derive the prompt-shell session kind from a task id (+ the caller's explicit-decomposition knowledge). Synthetic
 * session ids carry their kind as a `::` suffix (`<taskId>::review` / `::plan-critique` / `::merge`); home-agent
 * sidebar sessions use the `__home_agent__:` namespace ("chat"). Everything else is a card session: "architect"
 * when the caller knows it is an explicit decomposition (the `explicitDecompositionTaskIds` seam), else "worker".
 * APPROXIMATION (documented): unknown `::` suffixes (e.g. `::acceptance`, which never reaches the session-prompt
 * assembler today) fall through to "worker" — harmless, warmth is a preference, never a correctness input.
 */
export function derivePromptSessionKind(
	taskId: string,
	options?: { isExplicitDecomposition?: boolean },
): PromptSessionKind {
	if (isHomeAgentSessionId(taskId)) {
		return "chat";
	}
	if (taskId.endsWith("::review")) {
		return "review";
	}
	if (taskId.endsWith("::plan-critique")) {
		return "plan-critique";
	}
	if (taskId.endsWith("::merge")) {
		return "merge";
	}
	return options?.isExplicitDecomposition ? "architect" : "worker";
}

/**
 * Partial-warmth tier of a candidate whose last recorded shell key is `lastShellKey` against a prospective shell:
 * - "hot": same kind + workspace + model — the ~99%-shared-bytes case (full margin bonus);
 * - "warm": same workspace + model, different kind — the ~74%-shared-bytes case (half margin bonus);
 * - "cold": anything else (different workspace shares only the static template — not worth steering for).
 */
export type PromptShellWarmthTier = "hot" | "warm" | "cold";

export function classifyShellWarmth(lastShellKey: string, prospective: PromptShellIdentity): PromptShellWarmthTier {
	if (lastShellKey === buildPromptShellKey(prospective)) {
		return "hot";
	}
	const parts = lastShellKey.split(SHELL_KEY_SEPARATOR);
	if (parts.length === 3 && parts[1] === prospective.workspacePath && parts[2] === prospective.modelId) {
		return "warm";
	}
	return "cold";
}

export interface WarmthCandidate {
	/** The routing key (registry key) — opaque here. */
	modelKey: string;
	/** The launch/served model id — the id the warmth ledger is keyed by (what the prompt assembler records under). */
	modelId: string;
	/** Fit score, higher is better (same scale as the input ranking, e.g. blended capability points 0–100). */
	score: number;
}

/** One warmth-ledger entry: the last prompt-shell key a model assembled, and when (epoch ms). */
export interface PromptWarmthLedgerEntry {
	shellKey: string;
	at: number;
}

export interface WarmthPreferenceResult<T extends WarmthCandidate> {
	/** The (possibly re-ordered) ranking, best-first. */
	ranked: readonly T[];
	/** True when warmth re-ordered the ranking (a warmer candidate was promoted to the top within the margin). */
	warmthApplied: boolean;
	/** One-line rationale when warmth applied (for selection-reason / observation lines); null otherwise. */
	warmthReason: string | null;
}

export const DEFAULT_WARMTH_MARGIN_POINTS = 10;
/** After this long without a new assembly the server has likely evicted the prefix — count the model cold. */
export const DEFAULT_WARMTH_STALE_AFTER_MS = 10 * 60_000;

/**
 * Re-rank EXACTLY like `applyDiversityPreference`: a candidate whose last recorded shell matches the prospective
 * shell (same kind+workspace, "hot") may be promoted over a colder higher-scored candidate ONLY within
 * `marginPoints`; a same-workspace different-kind candidate ("warm") only within HALF the margin. Stale warmth
 * counts cold. When the top candidate is already the warmest available tier, the order stands (nothing to observe).
 *
 * DIVERSITY-FIRST INTERACTION (hard contract): warmth must never override the §5.AB diversity requirement for
 * decision roles — callers apply diversity FIRST (its result is authoritative) and pass warmth only the candidates
 * diversity allows; warmth then re-orders within that set. See `pickDiverseReviewerModel`.
 */
export function applyWarmthPreference<T extends WarmthCandidate>(input: {
	/** Fit-ranked candidates, best-first (rank 0 = the pick that would ship WITHOUT warmth). */
	ranked: readonly T[];
	/** The shell the new session will assemble (per-candidate modelId completes the identity). */
	sessionKind: PromptSessionKind;
	workspacePath: string;
	/** The warmth ledger: last shell key per model id (see `getPromptWarmthLedger`). */
	lastShellKeyByModel: ReadonlyMap<string, PromptWarmthLedgerEntry>;
	/** Injected clock (epoch ms) — the core stays pure. */
	now: number;
	marginPoints?: number;
	staleAfterMs?: number;
}): WarmthPreferenceResult<T> {
	const margin = input.marginPoints ?? DEFAULT_WARMTH_MARGIN_POINTS;
	const staleAfterMs = input.staleAfterMs ?? DEFAULT_WARMTH_STALE_AFTER_MS;
	const top = input.ranked[0];
	if (!top) {
		return { ranked: input.ranked, warmthApplied: false, warmthReason: null };
	}
	const tierOf = (candidate: T): PromptShellWarmthTier => {
		const entry = input.lastShellKeyByModel.get(candidate.modelId);
		if (!entry || input.now - entry.at > staleAfterMs) {
			return "cold";
		}
		return classifyShellWarmth(entry.shellKey, {
			sessionKind: input.sessionKind,
			workspacePath: input.workspacePath,
			modelId: candidate.modelId,
		});
	};
	const promote = (candidate: T, reason: string): WarmthPreferenceResult<T> => ({
		ranked: [candidate, ...input.ranked.filter((other) => other !== candidate)],
		warmthApplied: true,
		warmthReason: reason,
	});
	const topTier = tierOf(top);
	if (topTier === "hot") {
		// The pick that would ship anyway is already the warmest possible — order stands, nothing changed.
		return { ranked: input.ranked, warmthApplied: false, warmthReason: null };
	}
	const hot = input.ranked.find((candidate) => tierOf(candidate) === "hot" && top.score - candidate.score <= margin);
	if (hot) {
		return promote(
			hot,
			`promoted ${hot.modelKey} over ${top.modelKey} for a HOT ${input.sessionKind} prompt shell ` +
				`(${(top.score - hot.score).toFixed(1)} pts ≤ margin ${margin})`,
		);
	}
	if (topTier === "warm") {
		// No hot candidate in range and the default pick is already warm — don't shuffle among equals.
		return { ranked: input.ranked, warmthApplied: false, warmthReason: null };
	}
	const halfMargin = margin / 2;
	const warm = input.ranked.find(
		(candidate) => tierOf(candidate) === "warm" && top.score - candidate.score <= halfMargin,
	);
	if (warm) {
		return promote(
			warm,
			`promoted ${warm.modelKey} over ${top.modelKey} for a WARM same-workspace prompt shell ` +
				`(${(top.score - warm.score).toFixed(1)} pts ≤ half-margin ${halfMargin})`,
		);
	}
	return { ranked: input.ranked, warmthApplied: false, warmthReason: null };
}
