import { assessHopelessness, type HopelessnessVerdict } from "./failure-hopelessness";
import { classifyFailureSignature } from "./failure-signature";

/**
 * §5.AW hopelessness short-circuit, driven straight from RAW caught errors. `assessHopelessness`
 * ([failure-hopelessness.ts](./failure-hopelessness.ts)) needs each attempt PRE-CLASSIFIED into a stable failure
 * signature ({@link HopelessnessAttempt}); but the retry loop actually holds a list of `{modelId, error}` pairs — the
 * literal `unknown` value each attempt THREW. This is the missing adapter: it runs every raw error through the §5.AA
 * classifier ([failure-signature.ts](./failure-signature.ts)) and hands the resulting signatures to the hopelessness
 * assessor, so a caller with a pile of thrown errors gets the cross-lineage park verdict in one call.
 *
 * WHY key on the CLASSIFIED signature, not the raw error text: two different endpoints phrase the SAME failure class
 * differently ("ECONNREFUSED" vs "connection refused vs 127.0.0.1:1234") — a naive raw-string equality would miss that
 * they are the same problem, and the cross-lineage "the CARD is broken" signal would never fire. The classifier
 * collapses both into `model_unavailable`, so two DIFFERENT-lineage models throwing the same CLASS of error trip the
 * short-circuit even when their error strings differ. Conversely, two errors that classify to DIFFERENT signatures do
 * NOT trip it, even across diverse lineages — different problems, keep the ladder running.
 *
 * Pure + deterministic: no I/O, no clock, no randomness. Composes both cores BY IMPORT only (no edits). Re-exports the
 * {@link HopelessnessVerdict} type so a caller adapting from raw errors need not also reach into `failure-hopelessness`.
 */

export type { HopelessnessVerdict } from "./failure-hopelessness";

/** One raw failed attempt: the REAL (lineage-resolvable) model id plus the literal error value it threw. */
export interface FailedAttempt {
	/** The REAL model id (lineage-resolvable — not a per-machine alias). */
	modelId: string;
	/** Whatever the attempt threw / failed with — an `Error`, a raw string, or an endpoint `{error}` object. */
	error: unknown;
}

/**
 * Assess a list of raw `{modelId, error}` failures for the §5.AW cross-lineage identical-failure park signal (pure).
 * Each error is classified via `classifyFailureSignature` into its stable signature, then delegated to
 * `assessHopelessness` — so the verdict keys on the CLASSIFIED failure CLASS (two lineages failing with the same
 * signature ⇒ hopeless), never on the raw error string. Fewer than two attempts, same-lineage/unknown-lineage repeats,
 * or diverse lineages that classified to DIFFERENT signatures all return `hopeless:false` (keep trying).
 */
export function assessHopelessnessFromErrors(attempts: readonly FailedAttempt[]): HopelessnessVerdict {
	const classified = attempts.map((attempt) => ({
		modelId: attempt.modelId,
		signature: classifyFailureSignature(attempt.error).signature,
	}));
	return assessHopelessness(classified);
}
