import {
	applyFocusChainStepTiming,
	applyFocusChainStepTouches,
	type FocusChain,
	type FocusChainStepTouchDelta,
	type FocusChainSummary,
	normalizeFocusChain,
	repairFocusChainRegression,
	summarizeFocusChain,
} from "../core/focus-chain";

/**
 * §5.U — the per-task focus-chain state extracted from `InMemoryNKleinTaskSessionService` as a bounded collaborator. It
 * owns the `taskId → FocusChain` map and the apply-step-timing / summarize / delete / clear lifecycle; the external
 * "focus chain updated" notification and the clock are injected. Self-contained apart from those two deps.
 */
export interface FocusChainStore {
	/** The live chain for a task, or null when none is tracked. */
	get(taskId: string): FocusChain | null;
	/** F1.5 — restore a persisted chain into the live store (no-op when one exists; never notifies). */
	seed(taskId: string, chain: FocusChain): void;
	/** Merge a new focus-chain snapshot with the retained step timings, store it, and notify the update listener. */
	applyStep(taskId: string, chain: FocusChain): void;
	/** Attribute file/card touches to the currently active step, when a chain exists. */
	applyTouches(taskId: string, delta: FocusChainStepTouchDelta): void;
	/** The summary for a task's focus chain, or null when none is tracked. */
	summarize(taskId: string): FocusChainSummary | null;
	/** Forget a task's focus chain. */
	delete(taskId: string): void;
	/** Forget all tracked focus chains. */
	clear(): void;
}

export function createFocusChainStore(deps: {
	now: () => number;
	onUpdated?: (taskId: string, chain: FocusChain) => void | Promise<void>;
	/** F1.5 — a destructive re-emit was rejected (the prior chain was kept); surface it, e.g. as an observation. */
	onRepaired?: (taskId: string, reason: string) => void;
}): FocusChainStore {
	const chainByTaskId = new Map<string, FocusChain>();

	return {
		get(taskId) {
			return chainByTaskId.get(taskId) ?? null;
		},
		seed(taskId, chain) {
			// F1.5 rehydration: restore the persisted card chain into the live store on session start so per-step
			// timing survives a runtime restart. Never clobbers a chain the session already emitted, and never
			// echoes onUpdated (the seed IS the persisted state — re-writing it would be a no-op churn). The steps
			// pass through the normalizer so a hand-edited/corrupt persisted chain cannot inject a bad shape;
			// per-step timing/touches from the persisted chain are retained by matching text (same as applyStep).
			if (chainByTaskId.has(taskId)) {
				return;
			}
			const normalized = normalizeFocusChain(chain.steps, chain.updatedAt);
			if (!normalized) {
				return;
			}
			const timed = applyFocusChainStepTiming(chain, normalized, chain.updatedAt);
			chainByTaskId.set(taskId, applyFocusChainStepTouches(chain, timed));
		},
		applyStep(taskId, chain) {
			// F1.5 repair guard: an accidental wholesale reset keeps the prior chain (no store write, no notify —
			// re-persisting the unchanged prior chain would be churn) and surfaces the rejection.
			const previous = chainByTaskId.get(taskId);
			const verdict = repairFocusChainRegression(previous, chain);
			if (verdict.repaired) {
				deps.onRepaired?.(taskId, verdict.reason ?? "Destructive focus-chain re-emit rejected.");
				return;
			}
			const timed = applyFocusChainStepTiming(previous, chain, deps.now());
			const withTouches = applyFocusChainStepTouches(previous, timed);
			chainByTaskId.set(taskId, withTouches);
			void deps.onUpdated?.(taskId, withTouches);
		},
		applyTouches(taskId, delta) {
			const current = chainByTaskId.get(taskId);
			if (!current) {
				return;
			}
			const withTouches = applyFocusChainStepTouches(current, current, delta);
			chainByTaskId.set(taskId, withTouches);
			void deps.onUpdated?.(taskId, withTouches);
		},
		summarize(taskId) {
			return chainByTaskId.has(taskId) ? summarizeFocusChain(chainByTaskId.get(taskId)) : null;
		},
		delete(taskId) {
			chainByTaskId.delete(taskId);
		},
		clear() {
			chainByTaskId.clear();
		},
	};
}
