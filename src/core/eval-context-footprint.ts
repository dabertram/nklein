/**
 * §5.AB/§5.AD — SIZE/CONTEXT FOOTPRINT variants for the eval corpus. The §5.AD research finding is that a small local
 * model's output QUALITY degrades past an effective context budget (the "quality knee") well before its advertised
 * window fills. To LOCATE each model's knee, the fitness sweep runs the SAME task at growing context footprints and
 * watches where the score falls off — a needle-in-a-haystack probe: the real instruction is buried in progressively
 * more irrelevant "background" context. This module builds those variants purely.
 *
 * Invariant: a footprint variant changes ONLY the surrounding `prompt` text — the role, family, difficulty, and the
 * ANSWER KEY (reference DAG / acceptance tests / seeded defects + code) are byte-identical to the base row, so the
 * variant still self-scores 1 against the base's reference. The padding is deterministic (no RNG) so a re-eval at the
 * same footprint reproduces the exact same prompt, and the fingerprint/versioning story from the corpus carries over.
 *
 * Token counting here is the same lightweight `chars/4` estimate the chat budget defaults to — the harness needs
 * MONOTONE, reproducible footprints to bracket the knee, not exact tokenization, so a real tokenizer dependency (and
 * its cost) is deliberately avoided. Footprints are approximate by construction and documented as such.
 */

import type { EvalPrompt } from "./eval-prompt-corpus.js";

/** Average characters per token for the lightweight estimate (matches the chat-service default estimator). */
export const FOOTPRINT_CHARS_PER_TOKEN = 4;

/**
 * Canonical context footprints to probe, in tokens. Chosen to bracket the ≥32k context FLOOR: a lean baseline, then
 * doublings up to and past the floor, so the sweep can see a knee that appears BELOW the guaranteed window (the common
 * case for small quantized models). A base row whose own prompt already exceeds a tier is skipped for that tier
 * (never padded DOWN — truncating would corrupt the task).
 */
export const EVAL_CONTEXT_FOOTPRINTS: readonly number[] = [4_000, 8_000, 16_000, 32_000] as const;

/** Lightweight, deterministic token estimate for a string (`ceil(chars / 4)`). */
export function estimateTextTokens(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	return Math.ceil(text.length / FOOTPRINT_CHARS_PER_TOKEN);
}

/** The estimated token footprint of an eval prompt's instruction text. */
export function estimateEvalPromptTokens(prompt: EvalPrompt): number {
	return estimateTextTokens(prompt.prompt);
}

/**
 * A fixed bank of neutral "engineering handbook" sentences used as DISTRACTOR filler. Deliberately generic and
 * unrelated to any corpus task, so padding can never leak an answer hint or accidentally satisfy a scorer. Cycled
 * deterministically by index — same target ⇒ same filler.
 */
const FILLER_SENTENCES: readonly string[] = [
	"The deployment pipeline runs a linter, a type checker, and a unit-test stage before any artifact is published.",
	"Configuration values are read once at startup and treated as immutable for the lifetime of the process.",
	"Observability is layered: structured logs feed metrics, metrics feed dashboards, and dashboards feed alerts.",
	"Feature flags gate risky changes so they can be rolled out gradually and reverted without a redeploy.",
	"Backups are taken on a fixed schedule and their restores are rehearsed so recovery time is a known quantity.",
	"Every external call is wrapped with a timeout and a bounded retry to keep a slow dependency from cascading.",
	"Documentation lives next to the code it describes so the two drift apart as little as possible over time.",
	"Capacity planning tracks the trend of peak load, not the average, because the peak is what pages the on-call.",
	"Schema migrations are written to be backward compatible so a rollback never strands data in a half-state.",
	"Access is granted along the principle of least privilege and reviewed on a recurring cadence for staleness.",
];

/**
 * Deterministically generate at least `targetChars` characters of distractor filler by cycling the sentence bank.
 * Never random; the same target always yields the same text.
 */
function buildFiller(targetChars: number): string {
	if (targetChars <= 0) {
		return "";
	}
	const parts: string[] = [];
	let length = 0;
	let index = 0;
	while (length < targetChars) {
		const sentence = FILLER_SENTENCES[index % FILLER_SENTENCES.length];
		parts.push(sentence);
		length += sentence.length + 1; // +1 for the joining space
		index += 1;
	}
	return parts.join(" ");
}

const FOOTPRINT_PREAMBLE =
	"Background context (for reference only — the actual task is stated in the section marked TASK below):";
const TASK_MARKER = "\n\n=== TASK ===\n";
const FOOTPRINT_POSTAMBLE =
	"\n\n=== END TASK ===\nAdditional background context follows; it is not part of the task and can be ignored.";

/**
 * Build a footprint variant of `prompt` padded to approximately `targetTokens`. The real instruction is wrapped with a
 * clear TASK marker and surrounded (half before, half after) by deterministic distractor filler — the standard
 * needle-in-a-haystack layout. Returns the base prompt UNCHANGED (no padding, original id) when it already meets or
 * exceeds the target, since padding down is not meaningful. Otherwise the id gains a `#ctx<targetTokens>` suffix so it
 * keys a distinct harness result cell.
 */
export function buildContextFootprintVariant(prompt: EvalPrompt, targetTokens: number): EvalPrompt {
	const baseTokens = estimateEvalPromptTokens(prompt);
	if (!Number.isFinite(targetTokens) || targetTokens <= baseTokens) {
		return prompt;
	}
	// Structural scaffolding (markers + pre/postamble) also costs tokens; fold it into the base so the final footprint
	// lands near the target rather than overshooting by the scaffolding size.
	const scaffoldTokens = estimateTextTokens(FOOTPRINT_PREAMBLE + TASK_MARKER + FOOTPRINT_POSTAMBLE);
	const fillerTokens = Math.max(0, targetTokens - baseTokens - scaffoldTokens);
	const fillerChars = fillerTokens * FOOTPRINT_CHARS_PER_TOKEN;
	const before = buildFiller(Math.ceil(fillerChars / 2));
	const after = buildFiller(Math.floor(fillerChars / 2));

	const paddedPrompt = `${FOOTPRINT_PREAMBLE} ${before}${TASK_MARKER}${prompt.prompt}${FOOTPRINT_POSTAMBLE} ${after}`;
	// Only `id` + `prompt` change; the answer key + routing fields are preserved verbatim (spread), keeping the
	// discriminated union intact and the row self-scoring against its unchanged reference.
	return { ...prompt, id: `${prompt.id}#ctx${targetTokens}`, prompt: paddedPrompt };
}

/**
 * The full set of footprint variants for a base prompt across {@link EVAL_CONTEXT_FOOTPRINTS}: the base row itself
 * (the smallest, unpadded footprint) followed by one padded variant per tier LARGER than the base. Tiers at or below
 * the base prompt's own size are skipped (no down-padding), so a naturally-large `hard` prompt simply has fewer rungs.
 */
export function contextFootprintVariantsFor(prompt: EvalPrompt): EvalPrompt[] {
	const baseTokens = estimateEvalPromptTokens(prompt);
	const variants: EvalPrompt[] = [prompt];
	for (const target of EVAL_CONTEXT_FOOTPRINTS) {
		if (target > baseTokens) {
			variants.push(buildContextFootprintVariant(prompt, target));
		}
	}
	return variants;
}
