/**
 * Recovery budgets — the "bounded to N attempts" counters behind !Klein's self-recovery rungs.
 *
 * ── WHY THIS IS A CORE ──
 * P0.AUDIT0904 leg 12: six of these counters live in process-local `Map`s that are never cleared on success and
 * never persisted. Both halves are defects, and they fail in opposite directions.
 *
 * NOT PERSISTED means "bounded to 3" is really "bounded to 3 per restart". A card that has exhausted its budget
 * and is correctly held for the operator gets a fresh budget the moment the server restarts — and long factory
 * runs restart. The bound that was supposed to stop a loop is the one thing the loop resets.
 *
 * NOT CLEARED ON SUCCESS means a card that used two of its three attempts and then went green keeps those two
 * forever. Months later, a fresh problem on the same card gets one attempt instead of three, for reasons nobody
 * can see. A budget is a bound on consecutive failures, not a lifetime quota.
 *
 * This module is the pure fold. It knows nothing about files, workspaces or the runtime; the durable half lives in
 * `src/state/recovery-budget-store.ts`.
 */

export interface RecoveryBudgetEntry {
	/** How many attempts this budget has spent on this card SINCE its last success. */
	attempts: number;
	/** When the first attempt of the current streak happened. */
	firstAtMs: number;
	/** When the most recent attempt happened. */
	lastAtMs: number;
}

/** `budget name -> task key -> entry`. Task keys already carry the workspace (`workspace:task`). */
export type RecoveryBudgetLedger = Readonly<Record<string, Readonly<Record<string, RecoveryBudgetEntry>>>>;

export const EMPTY_RECOVERY_BUDGET_LEDGER: RecoveryBudgetLedger = {};

export function recoveryAttemptsFor(ledger: RecoveryBudgetLedger, budget: string, taskKey: string): number {
	return ledger[budget]?.[taskKey]?.attempts ?? 0;
}

/** Spend one attempt. Returns the ledger after the spend and the resulting count. */
export function spendRecoveryAttempt(
	ledger: RecoveryBudgetLedger,
	budget: string,
	taskKey: string,
	atMs: number,
): { ledger: RecoveryBudgetLedger; attempts: number } {
	const existing = ledger[budget]?.[taskKey];
	const next: RecoveryBudgetEntry = existing
		? { attempts: existing.attempts + 1, firstAtMs: existing.firstAtMs, lastAtMs: atMs }
		: { attempts: 1, firstAtMs: atMs, lastAtMs: atMs };
	return {
		ledger: { ...ledger, [budget]: { ...(ledger[budget] ?? {}), [taskKey]: next } },
		attempts: next.attempts,
	};
}

/** Set a budget's count outright — for the counters that record a timestamp rather than a tally. */
export function setRecoveryAttempts(
	ledger: RecoveryBudgetLedger,
	budget: string,
	taskKey: string,
	value: number,
	atMs: number,
): RecoveryBudgetLedger {
	const existing = ledger[budget]?.[taskKey];
	const next: RecoveryBudgetEntry = { attempts: value, firstAtMs: existing?.firstAtMs ?? atMs, lastAtMs: atMs };
	return { ...ledger, [budget]: { ...(ledger[budget] ?? {}), [taskKey]: next } };
}

/** Forget one budget's record for one card. */
export function forgetRecoveryBudget(
	ledger: RecoveryBudgetLedger,
	budget: string,
	taskKey: string,
): RecoveryBudgetLedger {
	if (ledger[budget]?.[taskKey] === undefined) {
		return ledger;
	}
	const { [taskKey]: _dropped, ...rest } = ledger[budget];
	return { ...ledger, [budget]: rest };
}

/**
 * A card succeeded: every recovery budget it was spending is released.
 *
 * This is the half that makes a budget mean "consecutive failures" instead of "lifetime quota". Returns the new
 * ledger and the names of the budgets that actually held something, so the caller can log a release that happened
 * without logging one that did not.
 */
export function releaseRecoveryBudgetsForTask(
	ledger: RecoveryBudgetLedger,
	taskKey: string,
): { ledger: RecoveryBudgetLedger; released: string[] } {
	const released = Object.keys(ledger).filter((budget) => ledger[budget][taskKey] !== undefined);
	if (released.length === 0) {
		return { ledger, released };
	}
	const next: Record<string, Record<string, RecoveryBudgetEntry>> = {};
	for (const [budget, entries] of Object.entries(ledger)) {
		const { [taskKey]: _dropped, ...rest } = entries;
		next[budget] = rest;
	}
	return { ledger: next, released };
}

/**
 * Drop entries whose last attempt is older than `maxAgeMs`.
 *
 * Without this the ledger grows for the life of the workspace, and a card whose last failure was in March should
 * not be carrying a strike in September — the streak it was counting ended long ago, whether or not anyone
 * recorded the success.
 */
export function pruneRecoveryBudgets(
	ledger: RecoveryBudgetLedger,
	nowMs: number,
	maxAgeMs: number,
): RecoveryBudgetLedger {
	const next: Record<string, Record<string, RecoveryBudgetEntry>> = {};
	let dropped = 0;
	for (const [budget, entries] of Object.entries(ledger)) {
		const kept: Record<string, RecoveryBudgetEntry> = {};
		for (const [taskKey, entry] of Object.entries(entries)) {
			if (nowMs - entry.lastAtMs <= maxAgeMs) {
				kept[taskKey] = entry;
			} else {
				dropped += 1;
			}
		}
		if (Object.keys(kept).length > 0) {
			next[budget] = kept;
		}
	}
	return dropped === 0 ? ledger : next;
}
