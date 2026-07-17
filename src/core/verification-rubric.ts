/**
 * F12.5 rubric-guided verification lens — PURE core.
 *
 * "Agentic rubrics as contextual verifiers": a reviewer told to verify an EXPLICIT per-item checklist derived from
 * the task's own spec produces more consistent verdicts than one told to "review this" — the rubric pins WHAT done
 * means for THIS card. This core extracts the rubric items from the card prompt (requirement bullets, acceptance
 * lines, must/shall sentences) and renders them as a review-lens stance demanding a per-item met / not-met /
 * cannot-tell verdict WITH evidence. Composes with the §5.AW lens system (this is a DYNAMIC lens; the static lenses
 * stay orthogonal perspectives). Pure + deterministic over the prompt text.
 */

export interface VerificationRubric {
	/** The extracted checklist items, capped and deduped, in spec order. */
	readonly items: readonly string[];
	/** True when nothing checklist-shaped was found (the lens should then be omitted, not emitted empty). */
	readonly empty: boolean;
}

const MAX_RUBRIC_ITEMS = 8;
const MAX_ITEM_LENGTH = 200;

/** Extract rubric items from a card prompt: bullets, Acceptance:/Success: lines, and must/shall sentences. */
export function buildVerificationRubric(taskPrompt: string): VerificationRubric {
	const items: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string) => {
		const item = raw.trim().replace(/\s+/g, " ");
		const key = item.toLowerCase();
		if (item.length >= 8 && item.length <= MAX_ITEM_LENGTH && !seen.has(key) && items.length < MAX_RUBRIC_ITEMS) {
			seen.add(key);
			items.push(item);
		}
	};
	for (const line of taskPrompt.split("\n")) {
		const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
		if (bullet?.[1]) {
			push(bullet[1]);
			continue;
		}
		const labeled = line.match(/^\s*(?:acceptance|success|done when|criteria)\s*:\s*(.+)$/i);
		if (labeled?.[1]) {
			push(labeled[1]);
		}
	}
	// Must/shall sentences outside bullets (prose specs).
	for (const sentence of taskPrompt.split(/(?<=[.!?])\s+/)) {
		if (/\b(?:must|shall|should)\b/i.test(sentence) && !/^\s*(?:[-*•]|\d+[.)])/.test(sentence)) {
			push(sentence);
		}
	}
	return { items, empty: items.length === 0 };
}

/** Render the rubric as a lens stance — one line per item, an explicit tri-state verdict demanded for each. */
export function renderRubricLensStance(rubric: VerificationRubric): string | null {
	if (rubric.empty) {
		return null;
	}
	return [
		"Verify this EXPLICIT rubric derived from the card's own spec — for EACH item answer met / not-met / cannot-tell, citing the diff line or test that proves it (cannot-tell without evidence is a finding, not a pass):",
		...rubric.items.map((item, index) => `${index + 1}. ${item}`),
	].join("\n");
}
