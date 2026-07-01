/**
 * Clarification option-set preparer (todo.md §5.S) — the pure data layer behind the manual-mode clarifying dialog.
 *
 * §5.S manual mode surfaces each open clarifying question in a dialog that must show **≥4 fitting options + a
 * free-text field**, as multi-choice or radio (the asking agent picks). The three existing §5.S cores decide
 * *whether* to ask (`clarification-need.ts`), *whether a default is safe to assume* (`assumption-safety.ts`), and
 * *how the auto loop resolves an open question* (`auto-clarify.ts`) — but none of them shapes the raw
 * `NKleinPlanQuestion.options` into something the dialog can render. An asking agent may emit two options, or
 * duplicates, or nothing but the recommended one; the UI needs a deterministic policy that dedupes, orders
 * (recommended first, then stable input order), guarantees the ≥N presentable-option floor by synthesising generic
 * fall-back options when the agent under-supplied, and reports the free-text affordance. That preparation is this
 * module's job — pure, deterministic, and independent of React.
 *
 * Pure + deterministic + NO I/O / model call: the question (and its options) is INJECTED as a plain value and the
 * same question always yields the same option set, so it belongs in the lower `core` layer and is fully
 * unit-testable. It composes upward: the manual-mode dialog (`§5.S "Manual-mode UI"`) consumes `prepareClarification
 * OptionSet` to lay out radios/checkboxes + the free-text box, and does NOT re-derive option ordering or the ≥N floor.
 * It reuses the plan-artifact question schema by import (`NKleinPlanQuestion` / `NKleinPlanQuestionOption`) and does
 * not edit it.
 */
import type { NKleinPlanQuestion, NKleinPlanQuestionOption } from "../nklein-agent/nklein-plan-artifacts";

/** How the dialog should let the user pick among the options. Mirrors the §5.S "multi-choice/radio" affordance. */
export type ClarificationSelectionMode =
	/** Exactly one option may be chosen (radio) — the default for a "which of these?" question. */
	| "single"
	/** Any number of options may be chosen (checkbox) — for "select all that apply" questions. */
	| "multiple";

/** A single presentable option: the schema fields plus whether it was synthesised to satisfy the ≥N floor. */
export interface PreparedClarificationOption {
	/** Stable option id (unique within the prepared set — synthesised ids are prefixed so they never collide). */
	id: string;
	/** The user-facing label. */
	label: string;
	/** Optional longer description (null when none). */
	description: string | null;
	/** Whether the asking agent marked this the recommended default. Synthesised options are never recommended. */
	recommended: boolean;
	/** True when this option was generated to reach the minimum count (not supplied by the agent). */
	synthesised: boolean;
}

/** The full prepared option set the manual-mode dialog renders (§5.S). */
export interface PreparedClarificationOptionSet {
	/** The question text, verbatim. */
	question: string;
	/** How to let the user select (radio vs. checkbox). */
	selectionMode: ClarificationSelectionMode;
	/** Deduped, ordered (recommended first, then input order), padded to at least the minimum-option floor. */
	options: PreparedClarificationOption[];
	/** Whether a free-text "other / none of these" field should be offered alongside the options. */
	allowFreeText: boolean;
	/** How many of the presented options the agent actually supplied (before any synthesis / padding). */
	suppliedCount: number;
	/** How many options were synthesised to reach the floor (0 when the agent supplied enough). */
	synthesisedCount: number;
}

/** Tunables for preparing an option set. All have §5.S-aligned defaults; callers may override per policy. */
export interface PrepareClarificationOptionSetConfig {
	/** The §5.S "≥4 fitting options" floor — the dialog always shows at least this many. */
	minOptions: number;
	/** Whether to offer the free-text field (the §5.S dialog always does; overridable for constrained questions). */
	allowFreeText: boolean;
	/** How the user selects among options (radio vs. checkbox). */
	selectionMode: ClarificationSelectionMode;
}

/** §5.S defaults: at least 4 options, free-text always offered, single-select (radio) unless told otherwise. */
export const DEFAULT_CLARIFICATION_OPTION_SET_CONFIG: PrepareClarificationOptionSetConfig = {
	minOptions: 4,
	allowFreeText: true,
	selectionMode: "single",
};

/** The generic fall-back labels used to pad an under-supplied option set, in order. Deterministic. */
export const SYNTHESISED_OPTION_LABELS: readonly string[] = [
	"Use your best judgement",
	"Follow the existing convention in the codebase",
	"Keep it minimal for now",
	"Do the most complete version",
	"None of these — let me specify",
];

const SYNTHESISED_ID_PREFIX = "synthesised:";

function isNonEmpty(value: string | null | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Clamp a possibly-dirty minimum-option count to a sane non-negative integer. A non-finite / negative floor collapses
 * to 0 (no padding), and a fractional floor truncates — so dirty config can never demand an absurd number of options.
 */
function resolveMinOptions(minOptions: number): number {
	if (!Number.isFinite(minOptions) || minOptions <= 0) {
		return 0;
	}
	return Math.trunc(minOptions);
}

/**
 * Dedupe supplied options by a normalised label (case/space-insensitive), keeping the FIRST occurrence but promoting
 * `recommended` if any duplicate was marked recommended. Options with an empty label/id are dropped (unrenderable).
 * Pure; input is not mutated.
 */
function dedupeSuppliedOptions(options: readonly NKleinPlanQuestionOption[]): PreparedClarificationOption[] {
	const byLabel = new Map<string, PreparedClarificationOption>();
	for (const option of options) {
		if (!isNonEmpty(option.label) || !isNonEmpty(option.id)) {
			continue;
		}
		const key = option.label.trim().toLowerCase();
		const existing = byLabel.get(key);
		if (existing) {
			// A later duplicate can only strengthen `recommended`; the first occurrence otherwise wins (stable).
			if (option.recommended) {
				existing.recommended = true;
			}
			continue;
		}
		byLabel.set(key, {
			id: option.id.trim(),
			label: option.label.trim(),
			description: isNonEmpty(option.description) ? option.description.trim() : null,
			recommended: option.recommended === true,
			synthesised: false,
		});
	}
	return [...byLabel.values()];
}

/**
 * Stable order for the dialog: every recommended option first (in their original relative order), then the rest in
 * their original relative order. Synthesised options are appended by the caller after this, so they always sort last.
 * Pure; returns a new array (does not mutate the input).
 */
function orderRecommendedFirst(options: readonly PreparedClarificationOption[]): PreparedClarificationOption[] {
	const recommended = options.filter((o) => o.recommended);
	const rest = options.filter((o) => !o.recommended);
	return [...recommended, ...rest];
}

/**
 * Build synthesised fall-back options to pad an under-supplied set up to `needed`, skipping any whose normalised
 * label already exists among the supplied options (so a synthesised label never duplicates a real one). Deterministic:
 * draws from `SYNTHESISED_OPTION_LABELS` in order. If the fixed label pool runs out it stops (never fabricates junk).
 */
function synthesiseOptions(needed: number, takenLabels: ReadonlySet<string>): PreparedClarificationOption[] {
	const synthesised: PreparedClarificationOption[] = [];
	for (let index = 0; index < SYNTHESISED_OPTION_LABELS.length && synthesised.length < needed; index++) {
		const label = SYNTHESISED_OPTION_LABELS[index];
		if (takenLabels.has(label.toLowerCase())) {
			continue;
		}
		synthesised.push({
			id: `${SYNTHESISED_ID_PREFIX}${index}`,
			label,
			description: null,
			recommended: false,
			synthesised: true,
		});
	}
	return synthesised;
}

/**
 * Prepare a plan-artifact question's options for the §5.S manual-mode clarifying dialog. Pure + deterministic: the
 * same question + config always yields the same option set. Steps: dedupe supplied options (case-insensitive, keeping
 * the first and promoting `recommended`), order recommended-first (then stable input order), then pad with generic
 * synthesised options until the `minOptions` floor is met (synthesised options always sort last and are never
 * recommended). The free-text affordance and selection mode come from the config (§5.S: free-text always offered,
 * radio by default). Never mutates the input question.
 */
export function prepareClarificationOptionSet(
	question: NKleinPlanQuestion,
	config: PrepareClarificationOptionSetConfig = DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
): PreparedClarificationOptionSet {
	const supplied = orderRecommendedFirst(dedupeSuppliedOptions(question.options ?? []));
	const minOptions = resolveMinOptions(config.minOptions);
	const shortfall = Math.max(0, minOptions - supplied.length);
	const takenLabels = new Set(supplied.map((o) => o.label.toLowerCase()));
	const synthesised = shortfall > 0 ? synthesiseOptions(shortfall, takenLabels) : [];

	return {
		question: question.question,
		selectionMode: config.selectionMode,
		options: [...supplied, ...synthesised],
		allowFreeText: config.allowFreeText,
		suppliedCount: supplied.length,
		synthesisedCount: synthesised.length,
	};
}

/**
 * Whether a prepared option set actually reached the §5.S "≥4 options" floor. Because the synthesised label pool is
 * finite, an extreme `minOptions` could exceed what padding can supply; the dialog can consult this to decide whether
 * to lean on the free-text field. Pure.
 */
export function meetsClarificationOptionFloor(
	prepared: PreparedClarificationOptionSet,
	minOptions = DEFAULT_CLARIFICATION_OPTION_SET_CONFIG.minOptions,
): boolean {
	return prepared.options.length >= resolveMinOptions(minOptions);
}
