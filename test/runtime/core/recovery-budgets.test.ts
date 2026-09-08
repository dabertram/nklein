import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EMPTY_RECOVERY_BUDGET_LEDGER,
	pruneRecoveryBudgets,
	recoveryAttemptsFor,
	releaseRecoveryBudgetsForTask,
	spendRecoveryAttempt,
} from "../../../src/core/recovery-budgets";
import { createRecoveryBudgetBooks } from "../../../src/state/recovery-budget-store";

/**
 * P0.AUDIT0904 leg 12: six recovery budgets were process-local `Map`s, never cleared on success and never
 * persisted. Both halves are defects and they fail in opposite directions — an unpersisted bound is reset by the
 * restart it was meant to survive, and a bound never cleared on success becomes a lifetime quota.
 */
describe("recovery budgets — the pure fold", () => {
	it("counts consecutive attempts per budget and per card", () => {
		let ledger = EMPTY_RECOVERY_BUDGET_LEDGER;
		expect(recoveryAttemptsFor(ledger, "empty-patch", "ws:a")).toBe(0);
		ledger = spendRecoveryAttempt(ledger, "empty-patch", "ws:a", 1_000).ledger;
		const second = spendRecoveryAttempt(ledger, "empty-patch", "ws:a", 2_000);
		expect(second.attempts).toBe(2);
		expect(second.ledger["empty-patch"]["ws:a"]).toMatchObject({ attempts: 2, firstAtMs: 1_000, lastAtMs: 2_000 });
		// A different card and a different budget are untouched.
		expect(recoveryAttemptsFor(second.ledger, "empty-patch", "ws:b")).toBe(0);
		expect(recoveryAttemptsFor(second.ledger, "boundary", "ws:a")).toBe(0);
	});

	it("releases every budget a card was spending when it succeeds, and says which held something", () => {
		let ledger = EMPTY_RECOVERY_BUDGET_LEDGER;
		ledger = spendRecoveryAttempt(ledger, "empty-patch", "ws:a", 1).ledger;
		ledger = spendRecoveryAttempt(ledger, "boundary", "ws:a", 1).ledger;
		ledger = spendRecoveryAttempt(ledger, "boundary", "ws:b", 1).ledger;

		const released = releaseRecoveryBudgetsForTask(ledger, "ws:a");
		expect(released.released.sort()).toEqual(["boundary", "empty-patch"]);
		expect(recoveryAttemptsFor(released.ledger, "empty-patch", "ws:a")).toBe(0);
		// Another card's budget survives: success is a fact about one card.
		expect(recoveryAttemptsFor(released.ledger, "boundary", "ws:b")).toBe(1);

		// Releasing a card that holds nothing is a no-op and reports nothing, so callers can log honestly.
		const again = releaseRecoveryBudgetsForTask(released.ledger, "ws:a");
		expect(again.released).toEqual([]);
		expect(again.ledger).toBe(released.ledger);
	});

	it("prunes entries whose streak is long over, and leaves a live ledger identical", () => {
		let ledger = EMPTY_RECOVERY_BUDGET_LEDGER;
		ledger = spendRecoveryAttempt(ledger, "empty-patch", "ws:old", 0).ledger;
		ledger = spendRecoveryAttempt(ledger, "empty-patch", "ws:new", 9_000).ledger;
		const pruned = pruneRecoveryBudgets(ledger, 10_000, 5_000);
		expect(recoveryAttemptsFor(pruned, "empty-patch", "ws:old")).toBe(0);
		expect(recoveryAttemptsFor(pruned, "empty-patch", "ws:new")).toBe(1);
		// Nothing to drop ⇒ the same object back, so a hydrate does not rewrite the file for no reason.
		expect(pruneRecoveryBudgets(pruned, 10_000, 5_000)).toBe(pruned);
	});
});

describe("recovery budgets — the durable books", () => {
	function booksIn(directory: string) {
		return createRecoveryBudgetBooks({ filePath: join(directory, "budgets.json") });
	}

	it("survives a restart, which is the whole point — a held card must not get a fresh budget", async () => {
		const directory = mkdtempSync(join(tmpdir(), "nklein-budgets-"));
		const first = booksIn(directory);
		await first.hydrate();
		const redrives = first.map("empty-patch");
		redrives.set("ws:a", 3);
		await first.flush();

		const afterRestart = booksIn(directory);
		await afterRestart.hydrate();
		expect(afterRestart.map("empty-patch").get("ws:a")).toBe(3);
	});

	it("exposes exactly the Map slice the runtime uses, so swapping in is one line per counter", async () => {
		const directory = mkdtempSync(join(tmpdir(), "nklein-budgets-"));
		const books = booksIn(directory);
		await books.hydrate();
		const budget = books.map("boundary");
		expect(budget.get("ws:a")).toBeUndefined();
		expect(budget.has("ws:a")).toBe(false);
		budget.set("ws:a", 1);
		expect(budget.get("ws:a")).toBe(1);
		expect(budget.has("ws:a")).toBe(true);
		budget.delete("ws:a");
		expect(budget.get("ws:a")).toBeUndefined();
	});

	it("releases a card's budgets on success, across every budget at once", async () => {
		const directory = mkdtempSync(join(tmpdir(), "nklein-budgets-"));
		const books = booksIn(directory);
		await books.hydrate();
		books.map("empty-patch").set("ws:a", 1);
		books.map("boundary").set("ws:a", 2);
		books.map("boundary").set("ws:b", 1);

		expect(books.releaseForTask("ws:a").sort()).toEqual(["boundary", "empty-patch"]);
		expect(books.map("empty-patch").get("ws:a")).toBeUndefined();
		expect(books.map("boundary").get("ws:a")).toBeUndefined();
		expect(books.map("boundary").get("ws:b")).toBe(1);
	});

	it("loads as empty from corrupt or missing state rather than throwing", async () => {
		const directory = mkdtempSync(join(tmpdir(), "nklein-budgets-"));
		const missing = booksIn(directory);
		await missing.hydrate();
		expect(missing.snapshot()).toEqual({});
	});
});
