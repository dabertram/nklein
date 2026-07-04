/**
 * Clarification-need detector + policy (todo.md §5.S) — the pure ENTRY GATE to the auto-clarify loop.
 *
 * §5.S is "detect when a task/request is under-specified/ambiguous enough to warrant asking the user a clarifying
 * question, *before* the agent proceeds". `auto-clarify.ts` already owns the loop that runs *once questions exist*
 * (architect ↔ reviewer ping-pong → answer / assumption); this module owns the step *before* that: given a raw
 * request, does it even need clarification? It extracts cheap heuristic ambiguity / under-specification signals
 * (vague pronouns with no antecedent, a missing target/object, conflicting constraints, multiple stated
 * interpretations, an empty/near-empty ask), scores them, and — for a chosen mode — returns a deterministic verdict
 * of whether to raise a clarifying question or just proceed.
 *
 * Pure + deterministic + NO model call (the decision logic is heuristic over extracted signals — the same request
 * always yields the same verdict), so it is fully unit-testable and belongs in the lower `core` layer. It composes
 * upward: the derived `score` / `needsClarification` can feed `task-complexity.ts`'s `ambiguous` input, and the
 * wiring (§5.S "wire into the flow") consults `assessClarificationNeed` after decomposition to decide whether to
 * open a question at all — the model-backed answering is `auto-clarify.ts`'s job, not this gate's.
 */

/** A distinct heuristic reason a request looks like it needs a clarifying question. */
export type ClarificationSignalKind =
	/** The ask is empty or so short it carries no actionable specification (e.g. "fix it", "do the thing"). */
	| "empty_or_trivial"
	/** Vague pronoun(s) ("it", "that", "this", "them") with no concrete antecedent in the request. */
	| "unresolved_pronoun"
	/** An action verb with no stated target/object ("update", "refactor", "add" — update *what*?). */
	| "missing_target"
	/** Conflicting constraints in the same request (e.g. "keep it minimal but also add everything"). */
	| "conflicting_constraints"
	/** The request explicitly offers multiple interpretations / open choices ("A or B", "either …", "maybe X"). */
	| "multiple_interpretations"
	/** An explicit hedge that the requester themselves is unsure ("not sure", "somehow", "or something"). */
	| "explicit_uncertainty";

/** One detected signal: its kind, the fixed weight it contributes, and a short human-readable justification. */
export interface ClarificationSignal {
	kind: ClarificationSignalKind;
	/** Fixed positive contribution to the aggregate score (see SIGNAL_WEIGHTS). */
	weight: number;
	/** Why this signal fired — safe to surface in a "why we're asking" explanation. */
	detail: string;
}

/** How aggressively to gate on clarification. Higher-autonomy modes tolerate more ambiguity before asking. */
export type ClarificationMode =
	/** Ask on the first real sign of ambiguity — for interactive / high-stakes work. */
	| "cautious"
	/** Ask only when the aggregate signal is clearly strong — the sensible default. */
	| "balanced"
	/** Only ask when the request is essentially unusable (empty / no target at all) — maximize autonomy. */
	| "autonomous";

/** Fixed per-kind weights (deterministic — no model). Empty/no-target dominate; softer hedges contribute less. */
export const SIGNAL_WEIGHTS: Readonly<Record<ClarificationSignalKind, number>> = {
	empty_or_trivial: 1,
	missing_target: 0.6,
	conflicting_constraints: 0.6,
	multiple_interpretations: 0.4,
	unresolved_pronoun: 0.35,
	explicit_uncertainty: 0.3,
};

/** Score at/above which each mode raises a clarifying question. Cautious asks early; autonomous almost never. */
export const MODE_THRESHOLDS: Readonly<Record<ClarificationMode, number>> = {
	cautious: 0.3,
	balanced: 0.6,
	autonomous: 1,
};

/** A request at/under this trimmed length with no other specification is treated as empty/trivial. */
const TRIVIAL_LENGTH = 12;

/** Vague pronouns that need an antecedent; flagged only when the request never names a concrete noun target. */
const VAGUE_PRONOUNS = /\b(?:it|its|that|this|these|those|them|they|here|there)\b/i;

/** An antecedent-y noun that would make a vague pronoun resolvable (a code/file/domain object was named). */
const CONCRETE_ANTECEDENT =
	/\b(?:file|function|module|class|method|component|variable|test|config|endpoint|table|field|column|button|page|dialog|panel|route|schema|type|prop|hook|import|error|bug|card|task|column|board|the\s+\w+\.[a-z]+)\b/i;

/** Bare action verbs — if the whole ask is just one of these (± filler) there's no stated target. */
const ACTION_VERBS =
	/\b(?:fix|update|change|add|remove|delete|refactor|improve|make|do|handle|implement|build|create|edit|adjust|tweak|clean\s*up|sort\s*out|deal\s+with)\b/i;

/** A stated target/object after the verb — a noun-ish token or a filename/path that grounds the action. */
const HAS_OBJECT = /\b(?:the|a|an|my|our|this|that|all|every|each)\b|\S+\.[a-z0-9]+|`[^`]+`|"[^"]+"/i;

/** Phrases signalling the requester offers several interpretations / open choices. */
const MULTIPLE_INTERPRETATIONS =
	/\b(?:either|or\s+(?:maybe\s+)?(?:something|other|the)\b|one\s+of|any\s+of|whichever|whatever\s+(?:you|works)|options?)\b|\b\w+\s+or\s+\w+\?|\bmaybe\b/i;

/** Explicit self-doubt from the requester — they're unsure what they want. */
const EXPLICIT_UNCERTAINTY =
	/\b(?:not\s+sure|unsure|i\s+think|i\s+guess|somehow|some\s*how|or\s+something|dunno|don't\s+know|no\s+idea|figure\s+out\s+what|whatever\s+makes\s+sense|up\s+to\s+you)\b/i;

/**
 * Pairs of mutually-tensioned intents; a request that states both sides looks internally conflicting.
 * Each entry is [sideA, sideB]; order-independent (both directions are checked).
 */
// NOTE: each alternation is GROUPED as `\b(?:a|b|c)\b`. Writing `\ba|b|c\b` is a bug — `|` has the lowest regex
// precedence, so the boundaries anchor only the first (`\ba`) and last (`c\b`) alternatives and every interior one
// matches as a bare substring (e.g. `replace` inside "irreplaceable", `full` inside "fully"), firing a spurious
// conflicting_constraints signal. Exception: `backward[- ]compat` is a deliberate PREFIX (must also match
// "backward-compatible"/"compatibility"), so it keeps only a leading boundary.
const CONFLICT_PAIRS: ReadonlyArray<readonly [RegExp, RegExp]> = [
	[
		/\b(?:minimal|small|simple|lightweight|tiny)\b/i,
		/\b(?:comprehensive|everything|full|complete|exhaustive|all\s+the)\b/i,
	],
	[/\b(?:fast|quick|quickly|asap|now)\b/i, /\b(?:thorough|careful|robust|production[- ]ready|polished)\b/i],
	[
		/\b(?:keep|don'?t\s+change|preserve|leave)\b/i,
		/\b(?:rewrite|replace|overhaul|redo\s+everything|from\s+scratch)\b/i,
	],
	[/\bbackward[- ]compat|\bnon[- ]breaking\b/i, /\b(?:breaking\s+change|drop\s+support|remove\s+the\s+old)\b/i],
];

/** The full assessment: the extracted signals, the aggregate score, and the mode-relative verdict. */
export interface ClarificationAssessment {
	/** Distinct detected signals (deduped by kind, ordered by descending weight then kind for determinism). */
	signals: ClarificationSignal[];
	/** Aggregate score = sum of detected signal weights, clamped to [0, 1]. */
	score: number;
	/** The mode this assessment was computed for. */
	mode: ClarificationMode;
	/** Whether, in `mode`, this request warrants a clarifying question (score ≥ the mode threshold). */
	needsClarification: boolean;
}

function isNonEmptyText(value: string | null | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Extract the distinct clarification signals present in a request. Pure + deterministic; each signal kind fires at
 * most once. An empty/near-empty ask short-circuits to the single `empty_or_trivial` signal (nothing else is
 * meaningful to detect in it).
 */
export function detectClarificationSignals(request: string | null | undefined): ClarificationSignal[] {
	if (!isNonEmptyText(request)) {
		return [signal("empty_or_trivial", "The request is empty — there is nothing to act on.")];
	}
	const text = request.trim();
	// A very short ask with no grounding noun/quote is treated as trivially under-specified.
	if (text.length <= TRIVIAL_LENGTH && !CONCRETE_ANTECEDENT.test(text) && !HAS_OBJECT.test(text)) {
		return [signal("empty_or_trivial", `The request is too short to specify a target ("${text}").`)];
	}

	const signals: ClarificationSignal[] = [];

	// Missing target: a bare action verb with no stated object/target anywhere in the ask.
	if (ACTION_VERBS.test(text) && !HAS_OBJECT.test(text) && !CONCRETE_ANTECEDENT.test(text)) {
		signals.push(signal("missing_target", "An action verb has no stated target — it's unclear what to act on."));
	}

	// Unresolved pronoun: a vague pronoun with no concrete antecedent named in the request.
	if (VAGUE_PRONOUNS.test(text) && !CONCRETE_ANTECEDENT.test(text)) {
		signals.push(signal("unresolved_pronoun", "A vague pronoun has no clear antecedent in the request."));
	}

	// Conflicting constraints: both sides of a tensioned intent pair appear.
	const conflict = findConflict(text);
	if (conflict) {
		signals.push(signal("conflicting_constraints", `Conflicting constraints: "${conflict}".`));
	}

	// Multiple interpretations explicitly offered by the requester.
	if (MULTIPLE_INTERPRETATIONS.test(text)) {
		signals.push(signal("multiple_interpretations", "The request offers multiple interpretations / open choices."));
	}

	// Explicit uncertainty / self-doubt from the requester.
	if (EXPLICIT_UNCERTAINTY.test(text)) {
		signals.push(signal("explicit_uncertainty", "The requester signals they are unsure what they want."));
	}

	return sortSignals(signals);
}

/**
 * Aggregate detected signals into a score in [0, 1] (sum of weights, clamped). Deterministic. A request with no
 * signals scores 0 (clearly specified); a compounding of soft signals can still cross a threshold.
 */
export function scoreClarificationSignals(signals: readonly ClarificationSignal[]): number {
	const raw = signals.reduce((sum, s) => sum + s.weight, 0);
	if (!Number.isFinite(raw) || raw <= 0) {
		return 0;
	}
	return Math.min(1, raw);
}

/**
 * The full clarification-need assessment for a request in a given mode (§5.S entry gate). Pure: same request + mode
 * → same verdict. Detects signals, scores them, and compares the score to the mode's threshold to decide whether
 * to raise a clarifying question before proceeding.
 */
export function assessClarificationNeed(
	request: string | null | undefined,
	mode: ClarificationMode = "balanced",
): ClarificationAssessment {
	const signals = detectClarificationSignals(request);
	const score = scoreClarificationSignals(signals);
	const threshold = MODE_THRESHOLDS[mode];
	return { signals, score, mode, needsClarification: score >= threshold };
}

function signal(kind: ClarificationSignalKind, detail: string): ClarificationSignal {
	return { kind, weight: SIGNAL_WEIGHTS[kind], detail };
}

/** Deterministic ordering: highest weight first, ties broken by kind name (stable across runs). */
function sortSignals(signals: ClarificationSignal[]): ClarificationSignal[] {
	return signals.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.kind.localeCompare(b.kind)));
}

/** Return a short label of the first conflicting-constraint pair found, or null if none. */
function findConflict(text: string): string | null {
	for (const [sideA, sideB] of CONFLICT_PAIRS) {
		if (sideA.test(text) && sideB.test(text)) {
			const a = text.match(sideA)?.[0]?.trim();
			const b = text.match(sideB)?.[0]?.trim();
			if (a && b) {
				return `${a} vs ${b}`;
			}
		}
	}
	return null;
}
