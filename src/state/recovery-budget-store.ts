import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import {
	EMPTY_RECOVERY_BUDGET_LEDGER,
	forgetRecoveryBudget,
	pruneRecoveryBudgets,
	type RecoveryBudgetLedger,
	recoveryAttemptsFor,
	releaseRecoveryBudgetsForTask,
	setRecoveryAttempts,
} from "../core/recovery-budgets";

/**
 * Durable home for the recovery budgets (see `src/core/recovery-budgets.ts` for why they must not be
 * process-local).
 *
 * ── THE INTERFACE IS A `Map` ON PURPOSE ──
 * The runtime holds these counters in `Map<string, number>` and reads them SYNCHRONOUSLY inside watchdog ticks
 * that are already deep in async work. Handing those call sites a promise would mean touching every one of them,
 * and a mechanical change to a recovery path is exactly where a subtle regression hides. So this exposes the small
 * slice of `Map` the runtime actually uses — `get`, `set`, `delete`, `has` — backed by a hydrated in-memory ledger
 * that writes through to disk. Swapping `new Map()` for `budgets.map("name")` is then a one-line change per
 * counter, and the reads stay synchronous and identical.
 *
 * Writes are fire-and-forget and debounced: a lost write costs at most one attempt of accuracy, whereas making a
 * watchdog await the disk would let a slow filesystem stall recovery. Persistence here is a durability
 * improvement over a `Map`, not a transaction.
 */

const recoveryBudgetEntrySchema = z.object({
	attempts: z.number(),
	firstAtMs: z.number(),
	lastAtMs: z.number(),
});
const recoveryBudgetFileSchema = z.object({
	schemaVersion: z.literal(1),
	budgets: z.record(z.string(), z.record(z.string(), recoveryBudgetEntrySchema)),
});

/** Entries untouched for a fortnight are dropped: the failure streak they were counting is long over. */
const MAX_ENTRY_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 750;

export interface RecoveryBudgetMap {
	get(key: string): number | undefined;
	set(key: string, value: number): void;
	delete(key: string): void;
	has(key: string): boolean;
}

export interface RecoveryBudgetBooks {
	/** A `Map`-shaped view of one named budget. */
	map(budget: string): RecoveryBudgetMap;
	/** A card succeeded: release every budget it was spending. Returns the budgets that actually held something. */
	releaseForTask(taskKey: string): string[];
	/** Load the persisted ledger. Safe to call once at startup; unreadable or corrupt state loads as empty. */
	hydrate(): Promise<void>;
	/** Flush any pending write. For tests and shutdown. */
	flush(): Promise<void>;
	/** Everything currently held, for diagnostics. */
	snapshot(): RecoveryBudgetLedger;
}

export function createRecoveryBudgetBooks(options?: { filePath?: string; now?: () => number }): RecoveryBudgetBooks {
	const filePath =
		options?.filePath ?? join(resolveNkleinRuntimeHomePath(homedir()), "recovery-budgets", "budgets.json");
	const now = options?.now ?? (() => Date.now());
	let ledger: RecoveryBudgetLedger = EMPTY_RECOVERY_BUDGET_LEDGER;
	let writeTimer: NodeJS.Timeout | null = null;
	let pendingWrite: Promise<void> = Promise.resolve();

	async function writeNow(): Promise<void> {
		const payload = `${JSON.stringify({ schemaVersion: 1, budgets: ledger }, null, "\t")}\n`;
		try {
			await mkdir(join(filePath, ".."), { recursive: true });
			// Write-and-rename: a crash mid-write must not leave a half-parsed ledger that hydrates as empty and
			// silently hands every held card a fresh budget — the exact failure this whole change exists to fix.
			const temporary = `${filePath}.${process.pid}.tmp`;
			await writeFile(temporary, payload, "utf8");
			await rename(temporary, filePath);
		} catch {
			// A ledger that cannot be written is a durability loss, never a reason to break recovery.
		}
	}

	function scheduleWrite(): void {
		if (writeTimer) {
			return;
		}
		writeTimer = setTimeout(() => {
			writeTimer = null;
			pendingWrite = writeNow();
		}, WRITE_DEBOUNCE_MS);
		writeTimer.unref?.();
	}

	return {
		map(budget: string): RecoveryBudgetMap {
			return {
				get: (key) => {
					const entry = ledger[budget]?.[key];
					return entry ? entry.attempts : undefined;
				},
				has: (key) => ledger[budget]?.[key] !== undefined,
				set: (key, value) => {
					ledger = setRecoveryAttempts(ledger, budget, key, value, now());
					scheduleWrite();
				},
				delete: (key) => {
					const next = forgetRecoveryBudget(ledger, budget, key);
					if (next !== ledger) {
						ledger = next;
						scheduleWrite();
					}
				},
			};
		},
		releaseForTask(taskKey: string): string[] {
			const { ledger: next, released } = releaseRecoveryBudgetsForTask(ledger, taskKey);
			if (released.length > 0) {
				ledger = next;
				scheduleWrite();
			}
			return released;
		},
		async hydrate(): Promise<void> {
			try {
				const parsed = recoveryBudgetFileSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")));
				ledger = parsed.success ? pruneRecoveryBudgets(parsed.data.budgets, now(), MAX_ENTRY_AGE_MS) : ledger;
			} catch {
				ledger = EMPTY_RECOVERY_BUDGET_LEDGER;
			}
		},
		async flush(): Promise<void> {
			if (writeTimer) {
				clearTimeout(writeTimer);
				writeTimer = null;
			}
			await pendingWrite;
			await writeNow();
		},
		snapshot: () => ledger,
	};
}

export { recoveryAttemptsFor };
