/**
 * Focus-chain diff (todo.md §5.N) — given the previous and next state of an agent's focus chain, compute *what
 * changed*: which steps were added, which were removed, which stayed but changed status (and in which direction),
 * and whether the surviving steps were reordered.
 *
 * Why a pure primitive for this: §5.N agents re-emit the *whole* checklist (text + per-step status) every time they
 * update it — the most reliable shape for small models, but it means "what actually moved" is implicit. Several
 * §5.N consumers need that made explicit and deterministic:
 *   - the reviewer-adherence check ("flags unfinished/mismatched steps" — did the worker actually own its chain, or
 *     silently drop/rewrite steps?),
 *   - the re-anchor-after-compaction seam (surface a compact "since last time: …" delta instead of the whole list),
 *   - per-step telemetry / run-summary narration (which step just started, which just finished).
 *
 * Steps are matched by their (already-normalized) text — the same identity `applyFocusChainStepTiming` uses — so an
 * edit that changes a step's wording reads as a remove + add, while a pure reorder/status-flip of unchanged text is
 * tracked as such. Fully pure and deterministic: it takes two chains as injected values and returns a plain report.
 */

import type { FocusChain, FocusChainStep, FocusChainStepStatus } from "./focus-chain";

/**
 * Ordinal "progress rank" of a status: how far a step has moved toward being finished. Used only to classify a
 * status change as forward (progress) vs backward (regression) — `skipped` and `done` are both terminal, so they
 * share the top rank and swapping between them is neither progress nor regression, just a change.
 */
const STATUS_PROGRESS_RANK: Record<FocusChainStepStatus, number> = {
	pending: 0,
	in_progress: 1,
	done: 2,
	skipped: 2,
};

/** A step present in both chains (matched by text) whose status differs between them. */
export interface FocusChainStatusChange {
	text: string;
	from: FocusChainStepStatus;
	to: FocusChainStepStatus;
	/** True when the step moved toward finished (rank increased), e.g. pending → in_progress → done. */
	progressed: boolean;
	/** True when the step moved away from finished (rank decreased), e.g. a done step re-opened to pending. */
	regressed: boolean;
}

export interface FocusChainDiff {
	/** Steps present in `next` but not in `previous` (by text), in their `next` order. */
	added: FocusChainStep[];
	/** Steps present in `previous` but not in `next` (by text), in their `previous` order. */
	removed: FocusChainStep[];
	/** Surviving steps whose status changed, in their `next` order. */
	statusChanged: FocusChainStatusChange[];
	/** True when the steps common to both chains appear in a different relative order. */
	reordered: boolean;
	/** True when anything at all changed (add / remove / status / reorder). */
	changed: boolean;
	/** True when at least one surviving step progressed and none regressed (net-forward movement). */
	progressed: boolean;
	/** True when at least one surviving step regressed (moved backward). */
	regressed: boolean;
}

const EMPTY_DIFF: FocusChainDiff = {
	added: [],
	removed: [],
	statusChanged: [],
	reordered: false,
	changed: false,
	progressed: false,
	regressed: false,
};

/**
 * Index a chain's steps by text, for membership + status lookups. A well-formed chain has unique step texts (the
 * normalizer trims/drops empties but does not dedupe); if a duplicate text somehow appears, later writes overwrite
 * earlier ones so `.get(text)` resolves to the last occurrence's status.
 */
function indexByText(steps: ReadonlyArray<FocusChainStep>): Map<string, FocusChainStep> {
	const byText = new Map<string, FocusChainStep>();
	for (const step of steps) {
		byText.set(step.text, step);
	}
	return byText;
}

/**
 * Diff two focus chains (previous → next), matching steps by text. Returns a plain, deterministic report of what
 * changed. Treats a missing chain (null/undefined) as an empty step list, so "no chain yet → first chain" reads as
 * all-added and "chain → cleared" reads as all-removed.
 */
export function diffFocusChains(
	previous: FocusChain | null | undefined,
	next: FocusChain | null | undefined,
): FocusChainDiff {
	const prevSteps = previous?.steps ?? [];
	const nextSteps = next?.steps ?? [];
	if (prevSteps.length === 0 && nextSteps.length === 0) {
		return EMPTY_DIFF;
	}

	const prevByText = indexByText(prevSteps);
	const nextByText = indexByText(nextSteps);

	const added = nextSteps.filter((step) => !prevByText.has(step.text));
	const removed = prevSteps.filter((step) => !nextByText.has(step.text));

	const statusChanged: FocusChainStatusChange[] = [];
	const statusChangedTexts = new Set<string>();
	let progressed = false;
	let regressed = false;
	for (const step of nextSteps) {
		const prior = prevByText.get(step.text);
		// Skip unmatched/unchanged steps, and (for a malformed chain with a repeated text) only report the first
		// occurrence so a text stays a single identity across the whole diff.
		if (!prior || prior.status === step.status || statusChangedTexts.has(step.text)) {
			continue;
		}
		statusChangedTexts.add(step.text);
		const forward = STATUS_PROGRESS_RANK[step.status] > STATUS_PROGRESS_RANK[prior.status];
		const backward = STATUS_PROGRESS_RANK[step.status] < STATUS_PROGRESS_RANK[prior.status];
		if (forward) {
			progressed = true;
		}
		if (backward) {
			regressed = true;
		}
		statusChanged.push({
			text: step.text,
			from: prior.status,
			to: step.status,
			progressed: forward,
			regressed: backward,
		});
	}

	// Reorder: compare the relative order of the steps common to both chains. Filtering each chain down to the
	// common texts (in that chain's own order) and comparing the resulting sequences ignores adds/removes — only a
	// genuine transposition of surviving steps counts as a reorder.
	const commonInNext = nextSteps.map((step) => step.text).filter((text) => prevByText.has(text));
	const commonInPrev = prevSteps.map((step) => step.text).filter((text) => nextByText.has(text));
	const reordered =
		commonInNext.length === commonInPrev.length && commonInNext.some((text, index) => text !== commonInPrev[index]);

	const changed = added.length > 0 || removed.length > 0 || statusChanged.length > 0 || reordered;

	return {
		added,
		removed,
		statusChanged,
		reordered,
		changed,
		// Net-forward only when something advanced and nothing slid back — a mixed turn (one step done, another
		// re-opened) is not reported as clean progress.
		progressed: progressed && !regressed,
		regressed,
	};
}
