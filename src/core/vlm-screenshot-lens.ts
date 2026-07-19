/**
 * F12.88 — the local-VLM screenshot review lens. PURE core.
 *
 * Coding models are TEXT-ONLY: they can read a CSS diff but cannot see that the result overlaps the header.
 * Subjective visual grading therefore needs a separate vision model, and this lens is where one plugs into the
 * existing review-lens system. It runs AFTER the deterministic gate (F12.87), so it is only ever asked about the
 * residue that deterministic checks cannot decide.
 *
 * ── THE FAILURE MODE THIS CORE EXISTS TO PREVENT ──
 * A VLM asked "does this look right?" will answer. It will answer when the screenshot is stale, when the
 * screenshot is of the wrong page, and when there is no screenshot at all and only the prompt's description to
 * go on. Its answer will be fluent and specific either way. **A confident visual verdict with no visual evidence
 * behind it is worse than no lens**, because a review lens carries authority the evidence does not.
 *
 * So this module refuses to produce a verdict it cannot ground:
 *  - No screenshot ⇒ `not_applicable`, never "looks fine". The lens declines rather than guessing.
 *  - The prompt demands the model cite WHAT IT SEES for each defect, and a verdict with no citation parses as
 *    inconclusive rather than as approval.
 *  - The lens is ADVISORY by construction: it can raise a concern, never clear a card on its own.
 */

export type VlmLensApplicability = "applicable" | "not_applicable";

export interface VlmLensDecision {
	readonly applicability: VlmLensApplicability;
	readonly reason: string;
}

export interface VlmLensGateInput {
	/** Paths the card touched. A change with no UI surface has nothing for a vision lens to judge. */
	readonly changedFilePaths: readonly string[];
	/** True when a screenshot of the CURRENT build is available. Absent evidence ⇒ the lens declines. */
	readonly hasScreenshot: boolean;
	/** True when a vision-capable model is actually loaded — the lens is fleet/RAM-gated. */
	readonly visionModelAvailable: boolean;
}

/** Extensions whose changes can plausibly alter rendered output. */
const UI_EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".less", ".html"];

/**
 * Decide whether the vision lens applies at all. Declining is the common and correct outcome — most cards touch
 * no UI, and a lens that runs anyway spends a vision model's memory to produce an opinion about nothing.
 */
export function decideVlmLens(input: VlmLensGateInput): VlmLensDecision {
	if (!input.visionModelAvailable) {
		return { applicability: "not_applicable", reason: "no vision-capable model is loaded — the lens is fleet-gated" };
	}
	const uiTouched = input.changedFilePaths.some((path) => {
		const lower = path.toLowerCase();
		return UI_EXTENSIONS.some((extension) => lower.endsWith(extension));
	});
	if (!uiTouched) {
		return {
			applicability: "not_applicable",
			reason: "no UI-surface files changed — there is no rendered difference for a vision lens to judge",
		};
	}
	if (!input.hasScreenshot) {
		// The important branch: NOT "looks fine", and not a guess from the diff. A vision lens without an image
		// has no evidence, and a fluent verdict built on none is exactly what this core refuses to emit.
		return {
			applicability: "not_applicable",
			reason:
				"UI files changed but NO screenshot is available — the lens declines rather than judging rendered output it cannot see",
		};
	}
	return {
		applicability: "applicable",
		reason: "UI files changed and a screenshot of the current build is available",
	};
}

export interface VlmLensPromptInput {
	/** What the card was supposed to achieve visually. */
	readonly objective: string;
	/** Spec/reference description of the intended appearance, when one exists. */
	readonly referenceDescription?: string | null;
}

/**
 * Build the vision-lens prompt. Two instructions carry the design: cite what is VISIBLE for every claim, and say
 * NOTHING_VISIBLE when the screenshot does not show enough — a lens that always finds something trains the
 * reviewer to ignore it, and a lens that invents detail is actively harmful.
 */
export function buildVlmLensPrompt(input: VlmLensPromptInput): string {
	return [
		"You are a VISUAL review lens. You are looking at a screenshot of a rendered UI.",
		"",
		"## What this change was meant to achieve",
		input.objective.trim(),
		...(input.referenceDescription?.trim() ? ["", "## Intended appearance", input.referenceDescription.trim()] : []),
		"",
		"## What to report",
		"Report only LAYOUT and RENDERING defects you can actually SEE: wrong size, misalignment, overlap,",
		"clipped or truncated content, missing components, unreadable contrast.",
		"",
		"For each defect, use exactly this shape, one per line:",
		"`DEFECT: <what is wrong> | SEEN: <what in the image shows it>`",
		"",
		"Rules:",
		"- Every DEFECT must have a SEEN citation describing what is visible. A claim you cannot point at is a guess.",
		"- Do NOT comment on code, naming, or anything the screenshot does not show.",
		"- If the screenshot does not show enough to judge — it is blank, cropped, still loading, or shows a",
		"  different page — reply exactly `NOTHING_VISIBLE` and stop.",
		"- If you can see the UI and it has no visible defects, reply exactly `NO_DEFECTS`.",
		"",
		"Do not speculate. An invented defect costs more than a missed one here, because a reviewer will act on it.",
	].join("\n");
}

export interface VisualDefect {
	readonly defect: string;
	readonly seen: string;
}

export type VlmVerdictKind = "no_defects" | "defects" | "inconclusive";

export interface VlmLensVerdict {
	readonly kind: VlmVerdictKind;
	readonly defects: readonly VisualDefect[];
	/** Advisory text for the reviewer, or null when there is nothing to say. */
	readonly reviewerNote: string | null;
}

const DEFECT_LINE = /^\s*(?:[-*]\s*)?DEFECT\s*:\s*(.+?)\s*\|\s*SEEN\s*:\s*(.+?)\s*$/i;
/** Cap so a chatty lens cannot flood the review. */
const MAX_DEFECTS = 5;

/**
 * Parse the lens reply. **A defect claim without a `SEEN:` citation is DROPPED**, not downgraded — the citation
 * is the only thing separating an observation from a plausible invention, and an uncited claim in a review note
 * would be acted on exactly as if it were seen. An empty or unparseable reply reads as `inconclusive`, never as
 * approval: this lens can raise a concern but must never clear a card.
 */
export function parseVlmLensVerdict(text: string): VlmLensVerdict {
	const trimmed = (text ?? "").trim();
	if (trimmed.length === 0) {
		return { kind: "inconclusive", defects: [], reviewerNote: null };
	}
	if (/^\s*NOTHING_VISIBLE\s*$/im.test(trimmed)) {
		return { kind: "inconclusive", defects: [], reviewerNote: null };
	}
	const defects: VisualDefect[] = [];
	for (const line of trimmed.split("\n")) {
		const match = line.match(DEFECT_LINE);
		if (match?.[1] && match[2] && defects.length < MAX_DEFECTS) {
			defects.push({ defect: match[1], seen: match[2] });
		}
	}
	if (defects.length > 0) {
		return {
			kind: "defects",
			defects,
			reviewerNote: [
				"A visual review lens flagged the following. These are ADVISORY — the lens can raise a concern but cannot",
				"clear or block a card on its own:",
				...defects.map((d) => `- ${d.defect} (seen: ${d.seen})`),
			].join("\n"),
		};
	}
	if (/^\s*NO_DEFECTS\s*$/im.test(trimmed)) {
		return { kind: "no_defects", defects: [], reviewerNote: null };
	}
	// Prose that named no citable defect: the model said something, but nothing we can act on.
	return { kind: "inconclusive", defects: [], reviewerNote: null };
}
