/**
 * Model keep-alive TTL SUGGESTION policy (todo §5.AN — the `ttl` (auto-evict) + JIT-loading lever, live-noted as a
 * request-level knob: "a request-level `ttl` controls how long a model stays loaded"). This is the PURE decision core
 * that turns usage signals into a *suggested* auto-evict TTL in seconds — the value the effectful loader would pass as
 * {@link import("./lms-model-control").LmsLoadOptions.ttlSeconds} to `lms load --ttl S` (or the `/api/v1/models/load`
 * TTL field). Nothing here loads or unloads a model or reads the clock: it only advises how long a model *should* stay
 * warm after a request, so a caller can right-size the TTL instead of hard-coding one.
 *
 * WHY it is SUGGESTION-ONLY (prime directive #1 — never autonomously load/unload; the user owns residency): a TTL is a
 * self-eviction hint the model server enforces on its own timer; suggesting one does NOT trigger a load or an immediate
 * unload — a resident model simply evicts itself later if left idle for the TTL. This module produces the number; the
 * decision to APPLY it stays with the guarded loader and the freeze-avoidance headroom guard. It never *extends*
 * residency of a running model and never issues an unload; the worst it can do is advise a shorter self-eviction window.
 *
 * The policy balances two costs that pull opposite ways:
 *   - **Reload cost** — a model that was expensive to load (big weights, slow cold start) is wasteful to evict if more
 *     work for it is imminent, so a longer keep-alive amortizes the reload.
 *   - **Memory cost** — a resident model holds host RAM; under pressure the safe move is to let it evict sooner so the
 *     RAM is reclaimable (the freeze-avoidance concern behind §5.AB / `model-load-headroom.ts`).
 * So: an ACTIVE session (mid-run / more work queued) keeps the model warm; a one-off SWEEP probe evicts fast; and
 * memory pressure always CAPS the suggestion downward — it can shorten a TTL but never lengthen one.
 *
 * Pure + deterministic (no clock, no I/O, no config reads) → fully unit-testable. The realized reloads / idle-evictions
 * feed the §5.AF ledger to tune the constants over time.
 */

/** How the model is being used right now — the primary driver of how long to keep it warm. */
export type KeepAliveUsagePattern =
	/** Mid-conversation or an active agent run: interactive follow-ups expected, keep it warm. */
	| "active_session"
	/** More queued work targets this SAME model: keep it warm to serve the batch without a reload. */
	| "batch_queue"
	/** A one-off dev/capability probe (e.g. a §5.AN sweep): let it self-evict quickly so it doesn't linger resident. */
	| "sweep_probe"
	/** No usage signal — a neutral default keep-alive. */
	| "idle";

/** Host memory pressure — a downward-only cap on the suggested TTL (never lengthens it). */
export type KeepAliveMemoryPressure = "low" | "high";

/** A suggested keep-alive TTL for one loaded model. */
export interface KeepAliveTtlSuggestion {
	/**
	 * Suggested auto-evict TTL in seconds to pass as `lms load --ttl`, or `null` to suggest NO auto-evict TTL (leave the
	 * model resident — the caller omits `ttlSeconds`, matching `buildLmsLoadArgs`, which drops `--ttl` when it is unset).
	 * Always a whole number of seconds when non-null.
	 */
	ttlSeconds: number | null;
	/** Human-readable rationale for the suggestion. */
	reason: string;
}

/** Neutral default keep-alive when no strong signal points either way (5 minutes — LM Studio's own default TTL). */
const DEFAULT_TTL_SECONDS = 300;

/** A one-off probe should self-evict quickly so a swept model doesn't linger resident and hold RAM. */
const SWEEP_PROBE_TTL_SECONDS = 60;

/** An active/interactive session keeps the model comfortably warm for follow-up turns. */
const ACTIVE_SESSION_TTL_SECONDS = 1_800;

/** A queued batch keeps the model warm long enough to drain the queue without a reload. */
const BATCH_QUEUE_TTL_SECONDS = 900;

/** Under memory pressure, cap the suggested TTL to this so a resident model becomes reclaimable sooner. */
const MEMORY_PRESSURE_TTL_CAP_SECONDS = 120;

/** Never suggest a TTL shorter than this — an unreasonably tiny window would thrash reload cost. */
const MIN_TTL_SECONDS = 30;

/** Never suggest a bounded TTL longer than this ceiling (an explicit `unbounded` request bypasses it → `null`). */
const MAX_TTL_SECONDS = 3_600;

/** Above this cold-load cost, a model is "expensive" enough that an idle keep-alive is lengthened to amortize reloads. */
const EXPENSIVE_LOAD_SECONDS = 20;

/**
 * Suggest an auto-evict keep-alive TTL for a just-served / about-to-load model from usage signals — the §5.AN `ttl`
 * lever, SUGGESTION-ONLY (this returns a number; it does NOT load, unload, or touch a clock).
 *
 * Decision order (first applicable rule sets the BASE, then memory pressure caps it):
 *
 *   1. `unbounded: true` → `null` (suggest NO `--ttl`: an explicit "keep resident" for a persistent interactive session;
 *      the caller omits `ttlSeconds`). This is the ONE case that skips the memory-pressure cap — the caller asked for
 *      residency outright — so it is only honored when `memoryPressure` is not `"high"`; under high pressure even an
 *      unbounded request is downgraded to the pressure-capped bounded TTL (safety wins over a warm cache).
 *   2. `usagePattern` sets the base keep-alive: `sweep_probe` → short (self-evict fast); `active_session` → long (warm
 *      for follow-ups); `batch_queue` → medium-long (drain the queue); `idle` → the neutral default, LENGTHENED toward
 *      the active window when the model was EXPENSIVE to load (`loadCostSeconds` over the threshold) so a costly reload
 *      is amortized even without an explicit follow-up signal.
 *   3. `memoryPressure: "high"` CAPS the base downward to {@link MEMORY_PRESSURE_TTL_CAP_SECONDS} (never lengthens it) —
 *      a resident model becomes reclaimable sooner, honoring the freeze-avoidance guard.
 *
 * The result is clamped into [{@link MIN_TTL_SECONDS}, {@link MAX_TTL_SECONDS}] and truncated to whole seconds.
 *
 * @param input.usagePattern How the model is being used right now (drives the base keep-alive).
 * @param input.memoryPressure Host memory pressure; `"high"` caps the suggestion downward. Optional (defaults to `"low"`).
 * @param input.loadCostSeconds Rough cold-load cost in seconds; a large value lengthens an otherwise-idle keep-alive.
 *   Optional (unknown ⇒ treated as inexpensive, no lengthening).
 * @param input.unbounded When true, suggest no auto-evict TTL (leave resident) — honored unless memory pressure is high.
 *   Optional (default false).
 */
export function suggestModelKeepAliveTtl(input: {
	usagePattern: KeepAliveUsagePattern;
	memoryPressure?: KeepAliveMemoryPressure;
	loadCostSeconds?: number;
	unbounded?: boolean;
}): KeepAliveTtlSuggestion {
	const pressureHigh = input.memoryPressure === "high";

	// Rule 1: an explicit "keep resident" request → no TTL, UNLESS memory pressure overrides it (safety wins).
	if (input.unbounded === true) {
		if (pressureHigh) {
			return {
				ttlSeconds: MEMORY_PRESSURE_TTL_CAP_SECONDS,
				reason: "unbounded keep-alive downgraded under memory pressure — evict sooner to free RAM",
			};
		}
		return { ttlSeconds: null, reason: "explicit unbounded keep-alive — leave resident (no --ttl)" };
	}

	// Rule 2: the usage pattern sets the base keep-alive.
	let baseTtl: number;
	let baseReason: string;
	switch (input.usagePattern) {
		case "sweep_probe":
			baseTtl = SWEEP_PROBE_TTL_SECONDS;
			baseReason = "one-off sweep probe — short TTL so it self-evicts quickly";
			break;
		case "active_session":
			baseTtl = ACTIVE_SESSION_TTL_SECONDS;
			baseReason = "active session — keep warm for follow-up turns";
			break;
		case "batch_queue":
			baseTtl = BATCH_QUEUE_TTL_SECONDS;
			baseReason = "queued batch — keep warm to drain the queue without a reload";
			break;
		default: {
			// idle: neutral default, but lengthen toward the active window if this model was expensive to load.
			const expensive = typeof input.loadCostSeconds === "number" && input.loadCostSeconds > EXPENSIVE_LOAD_SECONDS;
			baseTtl = expensive ? ACTIVE_SESSION_TTL_SECONDS : DEFAULT_TTL_SECONDS;
			baseReason = expensive
				? "idle but expensive to load — longer keep-alive to amortize the reload"
				: "idle — neutral default keep-alive";
			break;
		}
	}

	// Rule 3: memory pressure caps the base DOWNWARD only (never lengthens it).
	let ttl = baseTtl;
	let reason = baseReason;
	if (pressureHigh && ttl > MEMORY_PRESSURE_TTL_CAP_SECONDS) {
		ttl = MEMORY_PRESSURE_TTL_CAP_SECONDS;
		reason = `${baseReason}; capped under memory pressure to free RAM`;
	}

	// Clamp into the sane window and truncate to whole seconds.
	const clamped = Math.trunc(Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttl)));
	return { ttlSeconds: clamped, reason };
}
