/**
 * W2.3b (audit 2026-07-02, §5.AQ context economy) — the CACHE-STABLE-PREFIX fragment assembler.
 *
 * Local inference lives and dies by prompt-prefix caching: an endpoint re-uses KV state for the longest byte-stable
 * prefix it has seen. The live system prompt was raw string concatenation, and volatile content (per-task, per-day)
 * could land BEFORE slower-moving content — so one date rollover or task switch invalidated the cache for everything
 * after it. This core makes prefix stability a MODELED property instead of a convention:
 *
 *  - Every fragment declares its VOLATILITY class; the assembler orders ascending (static → config → daily → task →
 *    turn), so the byte-prefix shared across assemblies is maximal by construction.
 *  - A fragment can be PINNED to the head (`pinned: "head"`) when a hard contract requires it first (the SDK's base
 *    prompt must open the system message) — pinning is explicit and reported, never an accident of call order.
 *  - `computeSharedPrefixRatio` measures how much of two assembled prompts' bytes actually share a prefix — the
 *    `reuseRatio` telemetry that tells us whether the cache design is working on real traffic.
 *
 * Pure + deterministic: no I/O, no clock; same fragments in ⇒ same bytes out (input order breaks ties within a
 * volatility class, so callers control intra-class layout).
 */

import { isComponentIncludedForIntent, type PromptComponentTier, type PromptIntentMode } from "./prompt-intent-mode.js";

/** Volatility classes, slowest-changing first. Order here IS the assembly order. */
export const PROMPT_FRAGMENT_VOLATILITY_ORDER = ["static", "config", "daily", "task", "turn"] as const;

export type PromptFragmentVolatility = (typeof PROMPT_FRAGMENT_VOLATILITY_ORDER)[number];

export interface PromptFragment {
	/** Stable identifier for telemetry/debugging (e.g. "base", "efficiency-rules", "temporal-context"). */
	key: string;
	/** How often this fragment's content changes — decides its position (ascending). */
	volatility: PromptFragmentVolatility;
	text: string;
	/**
	 * "head" pins the fragment before everything else regardless of volatility — for hard contracts only (the SDK
	 * base prompt must open the message). Multiple pinned fragments keep input order. Pinned volatile content is
	 * reported in `headPinnedVolatileKeys` so the cache cost stays visible instead of silent.
	 */
	pinned?: "head";
	/**
	 * F4.39 prompt-intent tier. `essential` (the default when omitted) ships in EVERY intent mode; `standard` ships
	 * from `balance` up; `enriching` only in `max_task_info`. Omitting it keeps the fragment in every mode — so an
	 * un-tagged fragment set is byte-identical regardless of mode, and tiering is opt-in per fragment.
	 */
	tier?: PromptComponentTier;
	/** F4.39: a safety/format/containment INVARIANT that ships in every mode regardless of tier. */
	invariant?: boolean;
}

export interface AssembledPrompt {
	text: string;
	/** Fragment keys in final assembly order (empties dropped). */
	orderedKeys: string[];
	/**
	 * Keys of head-pinned fragments whose volatility is faster than "config" — each one caps the shareable prefix
	 * at its own churn rate, so the assembler surfaces them for the telemetry/derate layers to see.
	 */
	headPinnedVolatileKeys: string[];
}

const volatilityRank = new Map<PromptFragmentVolatility, number>(
	PROMPT_FRAGMENT_VOLATILITY_ORDER.map((volatility, index) => [volatility, index]),
);

/**
 * Assemble fragments into one prompt: head-pinned first (input order), then everything else by ascending volatility
 * (input order within a class). Empty/whitespace-only fragments are dropped. Fragments are joined with a blank line,
 * matching the existing `\n\n` concatenation convention at the session seams.
 */
export function assemblePromptFragments(fragments: readonly PromptFragment[]): AssembledPrompt {
	const nonEmpty = fragments
		.map((fragment, index) => ({ fragment, index }))
		.filter(({ fragment }) => fragment.text.trim().length > 0);
	const head = nonEmpty.filter(({ fragment }) => fragment.pinned === "head");
	const body = nonEmpty
		.filter(({ fragment }) => fragment.pinned !== "head")
		.sort((left, right) => {
			const rankDelta =
				(volatilityRank.get(left.fragment.volatility) ?? 0) - (volatilityRank.get(right.fragment.volatility) ?? 0);
			return rankDelta !== 0 ? rankDelta : left.index - right.index;
		});
	const ordered = [...head, ...body];
	return {
		text: ordered.map(({ fragment }) => fragment.text).join("\n\n"),
		orderedKeys: ordered.map(({ fragment }) => fragment.key),
		headPinnedVolatileKeys: head
			.filter(({ fragment }) => (volatilityRank.get(fragment.volatility) ?? 0) > (volatilityRank.get("config") ?? 0))
			.map(({ fragment }) => fragment.key),
	};
}

/**
 * F4.39: filter fragments down to those admitted by a prompt-intent mode BEFORE assembly. A fragment's `tier`
 * (default `essential` when omitted) and `invariant` flag decide inclusion via {@link isComponentIncludedForIntent}:
 * `minimize` keeps only essentials + invariants, `balance` adds `standard`, `max_task_info` keeps everything. Because
 * an omitted tier defaults to `essential` (kept in every mode), an un-tagged fragment set is byte-identical in EVERY
 * mode — tiering is opt-in per fragment, so adoption is incremental and safe. Order is preserved.
 */
export function selectPromptFragmentsForIntent(
	fragments: readonly PromptFragment[],
	mode: PromptIntentMode,
): PromptFragment[] {
	return fragments.filter((fragment) =>
		isComponentIncludedForIntent({ tier: fragment.tier ?? "essential", invariant: fragment.invariant }, mode),
	);
}

/**
 * Convenience: select fragments for the intent `mode` ({@link selectPromptFragmentsForIntent}), then assemble them
 * ({@link assemblePromptFragments}). With `max_task_info` (or any set of un-tiered fragments) this is byte-identical to
 * assembling the fragments directly — so a caller can adopt intent modes without changing its default output.
 */
export function assemblePromptFragmentsForIntent(
	fragments: readonly PromptFragment[],
	mode: PromptIntentMode,
): AssembledPrompt {
	return assemblePromptFragments(selectPromptFragmentsForIntent(fragments, mode));
}

/**
 * The fraction of `next`'s bytes covered by its longest common prefix with `previous` — the reuseRatio a prefix
 * cache could achieve when `next` follows `previous` on the same endpoint. 1 when identical, 0 when they diverge
 * at byte 0 (or `next` is empty). Codepoint-safe (iterates code points, ratio over code-point length).
 */
export function computeSharedPrefixRatio(previous: string, next: string): number {
	if (next.length === 0) {
		return 0;
	}
	const prev = [...previous];
	const curr = [...next];
	let shared = 0;
	const bound = Math.min(prev.length, curr.length);
	while (shared < bound && prev[shared] === curr[shared]) {
		shared += 1;
	}
	return shared / curr.length;
}
