/**
 * F4.8 — verify that end-of-context re-anchors retain what they are supposed to retain. PURE core.
 *
 * F4.8's requirement has four named elements: a long run must retain **objective, current focus, constraints, and
 * acceptance criteria** — "without duplicating large context". That last clause is what makes it non-trivial: the
 * cheap way to pass a retention check is to re-inject everything, which defeats the purpose. So coverage and cost
 * are assessed together, and a re-anchor that passes on content while bloating the context is not a pass.
 *
 * ── WHAT THIS FOUND ON THE LIVE PATH (2026-07-20) ──
 * Two re-anchor cores exist and they split F4.8's requirement:
 *  - `context-reanchor.ts` (§5.AD/§5.N) is **WIRED** — core → `task-reanchor-before-model` →
 *    `nklein-context-focus-extension` → the session runtime. It carries goal, current step, card title and recent
 *    tools: **objective ✓, current focus ✓.**
 *  - `instruction-reanchor.ts` (F12.21) carries **acceptance criteria** and the plan step, and has **ZERO
 *    importers** outside its own test.
 * So the two elements the live path is missing are exactly the two only the unwired core provides. F4.8 does not
 * fail because the mechanism is broken; it fails because **half of it was never connected**, and nothing surfaced
 * that because each core passes its own tests in isolation.
 *
 * Honesty stance: coverage is assessed from the STRUCTURED input a re-anchor was actually built from, never by
 * string-matching the rendered block. A block that happens to contain the word "acceptance" is not evidence that
 * acceptance criteria were carried, and a check that accepts it would report the gap above as covered — turning
 * this module into the thing it exists to detect.
 */

/** The four elements F4.8 names. Missing any of them is a coverage failure, not a style preference. */
export type ReanchorElement = "objective" | "current_focus" | "constraints" | "acceptance_criteria";

export const REQUIRED_REANCHOR_ELEMENTS: readonly ReanchorElement[] = [
	"objective",
	"current_focus",
	"constraints",
	"acceptance_criteria",
];

/**
 * What a re-anchor was built FROM — structured, not rendered. Each field is the value supplied for that element;
 * blank, whitespace-only and absent all count as not carried.
 */
export interface ReanchorSource {
	readonly objective?: string | null;
	readonly currentFocus?: string | null;
	readonly constraints?: readonly string[] | null;
	readonly acceptanceCriteria?: readonly string[] | null;
}

export interface CoverageAssessment {
	readonly covered: readonly ReanchorElement[];
	readonly missing: readonly ReanchorElement[];
	/** Rendered re-anchor size in characters. */
	readonly blockChars: number;
	/** Block size as a fraction of the surrounding context. */
	readonly contextShare: number;
	readonly withinBudget: boolean;
	readonly passed: boolean;
	readonly summary: string;
}

/**
 * A re-anchor above this share of the surrounding context stops being a reminder and becomes duplication — the
 * failure mode F4.8's "without duplicating large context" clause names. Deliberately generous: the point is to
 * catch re-injection of bulk context, not to police wording.
 */
export const MAX_REANCHOR_CONTEXT_SHARE = 0.05;

function carried(value: string | null | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function carriedList(value: readonly string[] | null | undefined): boolean {
	return Array.isArray(value) && value.some((entry) => carried(entry));
}

/**
 * Assess one re-anchor against F4.8.
 *
 * Passing requires BOTH full element coverage and staying within the size budget. They are not traded off: a
 * re-anchor that carries everything by pasting the context back in has solved nothing, and one that is admirably
 * small while dropping the acceptance criteria has solved nothing either.
 */
export function assessReanchorCoverage(input: {
	readonly source: ReanchorSource;
	readonly blockChars: number;
	readonly surroundingContextChars: number;
	readonly maxContextShare?: number;
}): CoverageAssessment {
	const { source } = input;
	const present = new Set<ReanchorElement>();
	if (carried(source.objective)) {
		present.add("objective");
	}
	if (carried(source.currentFocus)) {
		present.add("current_focus");
	}
	if (carriedList(source.constraints)) {
		present.add("constraints");
	}
	if (carriedList(source.acceptanceCriteria)) {
		present.add("acceptance_criteria");
	}

	const covered = REQUIRED_REANCHOR_ELEMENTS.filter((element) => present.has(element));
	const missing = REQUIRED_REANCHOR_ELEMENTS.filter((element) => !present.has(element));

	const maxShare = input.maxContextShare ?? MAX_REANCHOR_CONTEXT_SHARE;
	const contextShare = input.surroundingContextChars > 0 ? input.blockChars / input.surroundingContextChars : 0;
	const withinBudget = contextShare <= maxShare;
	const passed = missing.length === 0 && withinBudget;

	const notes: string[] = [];
	if (missing.length > 0) {
		notes.push(`missing ${missing.join(", ")} — a long run cannot retain what was never injected`);
	}
	if (!withinBudget) {
		notes.push(
			`re-anchor is ${(contextShare * 100).toFixed(1)}% of the surrounding context (budget ${(maxShare * 100).toFixed(1)}%) — this is duplication, not a reminder`,
		);
	}

	return {
		covered,
		missing,
		blockChars: input.blockChars,
		contextShare,
		withinBudget,
		passed,
		summary: passed
			? `re-anchor carries all ${REQUIRED_REANCHOR_ELEMENTS.length} required element(s) in ${(contextShare * 100).toFixed(2)}% of context`
			: notes.join("; "),
	};
}

/** What a wired re-anchor path contributes, for auditing which elements reach production. */
export interface ReanchorPathContribution {
	readonly module: string;
	readonly wired: boolean;
	readonly provides: readonly ReanchorElement[];
}

export interface PathAudit {
	readonly liveElements: readonly ReanchorElement[];
	readonly missingFromLive: readonly ReanchorElement[];
	/** Elements that exist in the codebase but only inside modules nothing imports. */
	readonly availableButUnwired: readonly ReanchorElement[];
	readonly passed: boolean;
	readonly summary: string;
}

/**
 * Audit which of F4.8's elements actually reach a live prompt.
 *
 * The `availableButUnwired` bucket is the point: "we never built it" and "we built it and never connected it" are
 * different problems with different fixes, and a report that merges them sends the work to the wrong place —
 * someone rebuilds a core that already exists, which is precisely the duplication the capability index (P15.6) was
 * added to prevent.
 */
export function auditReanchorPaths(contributions: readonly ReanchorPathContribution[]): PathAudit {
	const live = new Set<ReanchorElement>();
	const unwired = new Set<ReanchorElement>();
	for (const contribution of contributions) {
		for (const element of contribution.provides) {
			(contribution.wired ? live : unwired).add(element);
		}
	}

	const liveElements = REQUIRED_REANCHOR_ELEMENTS.filter((element) => live.has(element));
	const missingFromLive = REQUIRED_REANCHOR_ELEMENTS.filter((element) => !live.has(element));
	const availableButUnwired = missingFromLive.filter((element) => unwired.has(element));
	const passed = missingFromLive.length === 0;

	return {
		liveElements,
		missingFromLive,
		availableButUnwired,
		passed,
		summary: passed
			? `all ${REQUIRED_REANCHOR_ELEMENTS.length} F4.8 element(s) reach a live prompt`
			: `${missingFromLive.join(", ")} never reach a live prompt${
					availableButUnwired.length > 0
						? ` — and ${availableButUnwired.join(", ")} ${availableButUnwired.length === 1 ? "is" : "are"} ALREADY BUILT in a module nothing imports, so the fix is a wire, not a new core`
						: ""
				}`,
	};
}

/**
 * The re-anchor paths as they stand, traced 2026-07-20. Transcribed from an import trace rather than derived, so
 * it can drift — the same caveat `retry-ladder-divergence.ts` carries, and for the same reason.
 */
export const OBSERVED_REANCHOR_PATHS: readonly ReanchorPathContribution[] = [
	{
		// core -> task-reanchor-before-model -> nklein-context-focus-extension -> nklein-session-runtime
		//
		// ⚠️ **`wired: false` DESPITE THE IMPORT CHAIN BEING COMPLETE, and this is the whole finding.** The
		// injection site is guarded by `isTruthyEnv(process.env.NKLEIN_GOAL_REANCHOR)` and is **DEFAULT OFF**
		// (`nklein-context-focus-extension.ts`: "default OFF = byte-identical"). So in the shipped configuration
		// NO re-anchor block reaches any prompt, and F4.8 is not partially met — it is **entirely unmet**.
		//
		// This was nearly missed in the worst possible way. 2026-07-20 I extended this block to carry constraints
		// and acceptance criteria, which would have flipped the gate to COMPLETE while **nothing whatsoever
		// reaches a live prompt by default** — an audit reporting a requirement satisfied by code that does not
		// run. "Imported" and "reaches a live prompt" are different claims, and only tracing the import chain
		// proves the weaker one.
		module: "context-reanchor.ts",
		wired: false,
		provides: ["objective", "current_focus", "constraints", "acceptance_criteria"],
	},
	{
		// F12.21. Zero importers outside its own test. A SECOND, event-driven mechanism (loop / tool-error
		// triggers) rather than a piece of the cadence path — so wiring it is F12.21's item, not F4.8's.
		module: "instruction-reanchor.ts",
		wired: false,
		provides: ["acceptance_criteria"],
	},
];
