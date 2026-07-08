import {
	applyFocusChainStepTiming,
	applyFocusChainStepTouches,
	type FocusChain,
	type FocusChainStepTouchDelta,
	type FocusChainSummary,
	summarizeFocusChain,
} from "../core/focus-chain";

/**
 * §5.U — the per-task focus-chain state extracted from `InMemoryNKleinTaskSessionService` as a bounded collaborator. It
 * owns the `taskId → FocusChain` map and the apply-step-timing / summarize / delete / clear lifecycle; the external
 * "focus chain updated" notification and the clock are injected. Self-contained apart from those two deps.
 */
export interface FocusChainStore {
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
}): FocusChainStore {
	const chainByTaskId = new Map<string, FocusChain>();

	return {
		applyStep(taskId, chain) {
			const timed = applyFocusChainStepTiming(chainByTaskId.get(taskId), chain, deps.now());
			const withTouches = applyFocusChainStepTouches(chainByTaskId.get(taskId), timed);
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
