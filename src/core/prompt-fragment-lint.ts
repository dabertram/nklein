/**
 * Prompt-fragment linter (F12.79 instruction-budget + F12.80 positive-phrasing, todo §5.AF / Phase 12).
 *
 * Two research-backed hygiene checks over an ASSEMBLED prompt or a rules fragment, both PURE/heuristic (no I/O, no model
 * call). They are advisory — the caller decides whether to warn, trim, or block:
 *
 *   1. Instruction budget (IFScale, GitHub 2,500-repo study). Even frontier models reliably follow only ~150–200 discrete
 *      instructions and hit just ~68% at 500; small models fall off far sooner, and >150-line rules add 20–23% inference
 *      cost with NO quality gain. `lintInstructionBudget` counts the discrete instruction-bearing units in the final text
 *      and compares to a model-size-scaled cap.
 *
 *   2. Positive phrasing (the "pink elephant" effect; gadlet/16x). "Don't / never / avoid" forces the model to process the
 *      forbidden concept and is only weakly suppressed; the 2,500-repo study found warning-only rules underperform a
 *      prohibition PAIRED with a concrete alternative. `lintProhibitions` finds bare negatives that lack an "instead / use
 *      X / rather than" alternative and flags them for a positive rewrite.
 *
 * These are deliberately conservative lexical heuristics: they under-count rather than hallucinate instructions, and they
 * only flag a negative when no alternative is nearby. The goal is a useful signal on prompt bloat / phrasing, not a parser.
 */

// --- shared unit extraction --------------------------------------------------------------------------------------------

/** Modal / obligation markers that make a sentence an instruction even without an imperative lead verb. */
const MODAL_MARKERS = [
	"must",
	"should",
	"shall",
	"always",
	"never",
	"ensure",
	"make sure",
	"be sure",
	"do not",
	"don't",
	"avoid",
	"required",
	"require",
	"mandatory",
	"may not",
	"cannot",
	"can't",
	"need to",
	"has to",
	"have to",
];

/** Common line-initial imperative verbs in coding-agent rules. Lowercase, punctuation-stripped first word is matched. */
const IMPERATIVE_LEAD_VERBS = new Set([
	"use",
	"add",
	"remove",
	"create",
	"delete",
	"write",
	"read",
	"run",
	"check",
	"verify",
	"prefer",
	"keep",
	"return",
	"call",
	"set",
	"avoid",
	"ensure",
	"include",
	"exclude",
	"follow",
	"treat",
	"emit",
	"apply",
	"wrap",
	"split",
	"cap",
	"limit",
	"never",
	"always",
	"do",
	"don't",
	"make",
	"put",
	"place",
	"name",
	"format",
	"prefix",
	"reject",
	"accept",
	"handle",
	"validate",
	"report",
	"surface",
	"confirm",
	"ask",
	"stop",
	"start",
	"load",
	"unload",
	"respect",
	"enforce",
	"prioritize",
	"default",
	"assume",
	"consider",
	"note",
	"remember",
	"list",
	"describe",
	"explain",
	"provide",
	"output",
	"skip",
	"drop",
	"pin",
	"quote",
	"escape",
	"sanitize",
	"gate",
	"throttle",
	"retry",
	"fail",
	"log",
	"record",
	"persist",
]);

const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** A single instruction unit lifted from the prompt (a bullet item or an instruction-bearing sentence). */
export interface InstructionUnit {
	readonly text: string;
	/** True when the unit's first word is a known imperative verb. */
	readonly imperativeLead: boolean;
	/** The modal/obligation markers present (may be empty when the unit qualified by imperative lead alone). */
	readonly markers: readonly string[];
}

function firstWord(line: string): string {
	const stripped = line.replace(BULLET_RE, "").trimStart();
	const match = stripped.match(/^[A-Za-z']+/);
	return (match?.[0] ?? "").toLowerCase();
}

function markersIn(lower: string): string[] {
	return MODAL_MARKERS.filter((m) => {
		// Word-ish boundary check so "must" doesn't match "mustard" and "do not" matches as a phrase.
		const idx = lower.indexOf(m);
		if (idx < 0) {
			return false;
		}
		const before = idx === 0 ? " " : lower[idx - 1];
		const after = idx + m.length >= lower.length ? " " : lower[idx + m.length];
		return !/[a-z']/.test(before ?? " ") && !/[a-z']/.test(after ?? " ");
	});
}

/**
 * Extract the instruction-bearing units from a prompt. A unit is a bullet/numbered item or a sentence that either starts
 * with a known imperative verb or contains a modal/obligation marker. Prose that carries no instruction is ignored, so the
 * count tracks directives rather than word volume.
 */
export function extractInstructionUnits(text: string): InstructionUnit[] {
	const units: InstructionUnit[] = [];
	const lines = text.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		const isBullet = BULLET_RE.test(rawLine);
		// Split a line into sentence-ish clauses so "Use X. Never Y." counts as two directives.
		const clauses = isBullet ? [line.replace(BULLET_RE, "")] : line.split(/(?<=[.!;])\s+/);
		for (const clause of clauses) {
			const trimmed = clause.trim();
			if (trimmed.length === 0) {
				continue;
			}
			const lower = trimmed.toLowerCase();
			const imperativeLead = IMPERATIVE_LEAD_VERBS.has(firstWord(trimmed));
			const markers = markersIn(lower);
			if (imperativeLead || markers.length > 0) {
				units.push({ text: trimmed, imperativeLead, markers });
			}
		}
	}
	return units;
}

// --- F12.79: instruction budget ----------------------------------------------------------------------------------------

/**
 * Instruction cap for a model of the given parameter size (billions). ~5 instructions per B, clamped to [20, 150]: a 32B+
 * model gets the ~150 frontier ceiling, a 7B model ~35, a 4B model the ~20 floor — small models degrade fastest, so their
 * budgets are tightest. Unknown size ⇒ a conservative middle (60).
 */
export function instructionCapForModel(modelSizeB?: number): number {
	if (!modelSizeB || modelSizeB <= 0) {
		return 60;
	}
	return Math.max(20, Math.min(150, Math.round(modelSizeB * 5)));
}

export interface InstructionBudgetLint {
	readonly count: number;
	readonly cap: number;
	readonly overBudget: boolean;
	/** How many instructions over the cap (0 when within budget). */
	readonly overBy: number;
	readonly units: readonly InstructionUnit[];
	readonly advice: string;
}

export interface InstructionBudgetOptions {
	/** Model parameter size in billions; used to derive the cap when `cap` is not given directly. */
	readonly modelSizeB?: number;
	/** Explicit cap; overrides the model-size-derived one. */
	readonly cap?: number;
}

/**
 * Count the discrete instructions in the assembled prompt and compare to a model-size-scaled cap. Over budget ⇒ advice to
 * shed the most volatile / least load-bearing directives first (the caller knows the volatility tiers; this names the
 * overshoot). Within budget ⇒ a short all-clear.
 */
export function lintInstructionBudget(text: string, options: InstructionBudgetOptions = {}): InstructionBudgetLint {
	const units = extractInstructionUnits(text);
	const cap = options.cap ?? instructionCapForModel(options.modelSizeB);
	const count = units.length;
	const overBudget = count > cap;
	const overBy = overBudget ? count - cap : 0;
	const advice = overBudget
		? `${count} instructions exceed the ${cap}-instruction budget by ${overBy}; shed the ${overBy} most volatile / least load-bearing directives (small models follow only ~150 and far fewer when weak).`
		: `${count}/${cap} instructions — within budget.`;
	return { count, cap, overBudget, overBy, units, advice };
}

// --- F12.80: positive phrasing ----------------------------------------------------------------------------------------

const NEGATIVE_MARKERS = ["do not", "don't", "never", "avoid", "may not", "cannot", "can't", "must not", "shouldn't"];
/** Signals that a concrete alternative accompanies the prohibition (so it is NOT bare). */
const ALTERNATIVE_SIGNALS = [
	"instead",
	"rather than",
	"rather, ",
	"; use ",
	" use the ",
	" prefer ",
	" replace ",
	" in place of ",
];

export interface ProhibitionFinding {
	readonly text: string;
	/** The negative marker that triggered the finding. */
	readonly marker: string;
	/** True when a concrete alternative ("instead / use X / rather than") was found nearby. */
	readonly hasAlternative: boolean;
	readonly suggestion: string;
}

export interface ProhibitionLint {
	readonly findings: readonly ProhibitionFinding[];
	/** Findings lacking a paired alternative — the ones worth rewriting. */
	readonly bareCount: number;
	readonly advice: string;
}

/**
 * Flag bare prohibitions. Each instruction unit containing a negative marker is checked for an accompanying concrete
 * alternative; those without one are the "pink elephant" risk (weakly suppressed, no positive target) and are surfaced with
 * a rewrite suggestion. A prohibition already paired with an alternative is reported but not counted as bare.
 */
export function lintProhibitions(text: string): ProhibitionLint {
	const units = extractInstructionUnits(text);
	const findings: ProhibitionFinding[] = [];
	for (const unit of units) {
		const lower = unit.text.toLowerCase();
		const marker = NEGATIVE_MARKERS.find((m) => {
			const idx = lower.indexOf(m);
			if (idx < 0) {
				return false;
			}
			const before = idx === 0 ? " " : lower[idx - 1];
			return !/[a-z']/.test(before ?? " ");
		});
		if (!marker) {
			continue;
		}
		const hasAlternative = ALTERNATIVE_SIGNALS.some((s) => lower.includes(s.trim()));
		findings.push({
			text: unit.text,
			marker,
			hasAlternative,
			suggestion: hasAlternative
				? "prohibition is paired with an alternative — OK."
				: `rephrase positively or pair with a concrete alternative (e.g. "…; use <X> instead") — bare "${marker}" is weakly suppressed.`,
		});
	}
	const bareCount = findings.filter((f) => !f.hasAlternative).length;
	const advice =
		bareCount === 0
			? `no bare prohibitions (${findings.length} negative instruction(s), all paired with an alternative).`
			: `${bareCount} bare prohibition(s) of ${findings.length} — rephrase positively or pair each with a concrete alternative.`;
	return { findings, bareCount, advice };
}

// --- combined ----------------------------------------------------------------------------------------------------------

export interface PromptFragmentLint {
	readonly budget: InstructionBudgetLint;
	readonly prohibitions: ProhibitionLint;
	/** True when either check has something worth acting on. */
	readonly hasWarnings: boolean;
}

/** Run both fragment checks over one prompt/rules text. */
export function lintPromptFragment(text: string, options: InstructionBudgetOptions = {}): PromptFragmentLint {
	const budget = lintInstructionBudget(text, options);
	const prohibitions = lintProhibitions(text);
	return { budget, prohibitions, hasWarnings: budget.overBudget || prohibitions.bareCount > 0 };
}
