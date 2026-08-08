/**
 * P20.2 / P23.5 held-out oracle probe — BITEMPORAL correctness and LEDGER IMMUTABILITY (project 07).
 *
 * ── A TENTH INVARIANT FAMILY: what the past is allowed to become ──
 * The spec states this project's defining property outright: conservation of money under an immutable,
 * append-only ledger, where "the only legal way to undo the past is to record a new, offsetting present". Two
 * things follow, and neither is reachable by a single-date fixture:
 *
 *  1. `balanceAsOf` is BITEMPORAL — it filters on `effectiveAt`, on `postedAt`, AND on `discardedAt > knownAt`.
 *     An implementation that filters on `effectiveAt` alone satisfies any test written against one date and then
 *     answers every backdated-correction query wrong. That is the query a regulator actually asks: "what did you
 *     believe on the 5th, about the 1st?"
 *  2. A reversal is a NEW entry. After reversing, the original must STILL be in the log and the balance must be
 *     restored by addition, not by removal. A store that deletes or mutates gets the balance right and destroys
 *     the audit trail — the one failure this domain cannot tolerate, and one no balance assertion can detect.
 *
 * Binds only to the spec's prescribed modules (`src/ledger-store.ts`, `src/journal-validator.ts`).
 * Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const CANDIDATES = ["src/ledger-store.ts", "src/journal-validator.ts", "src/ledger.ts", "src/index.ts"];
const loaded: Record<string, unknown>[] = [];
for (const candidate of CANDIDATES) {
	try {
		loaded.push((await import(pathToFileURL(join(workspace, candidate)).href)) as Record<string, unknown>);
	} catch {
		// Not every candidate exists; the lookup below names what was actually missing.
	}
}
function exported<T>(name: string): T {
	for (const module of loaded) {
		if (typeof module[name] === "function") {
			return module[name] as T;
		}
	}
	throw new Error(`The workspace exports no ${name} — looked in ${CANDIDATES.join(", ")}.`);
}

// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
type Any = any;
const createLedgerStore = exported<() => Any>("createLedgerStore");
const balanceOf = exported<(store: Any, accountId: string, currency: string) => bigint>("balanceOf");
const balanceAsOf =
	exported<(store: Any, accountId: string, currency: string, effectiveAt: string, knownAt: string) => bigint>(
		"balanceAsOf",
	);
const validateJournalBalance = exported<(entries: Any[]) => { ok: boolean }>("validateJournalBalance");

let sequence = 0;
function entry(overrides: Record<string, unknown>) {
	sequence += 1;
	return {
		entryId: `e${sequence}`,
		journalId: "j0",
		accountId: "acct-1",
		direction: "debit",
		amount: 100n,
		currency: "USD",
		effectiveAt: "2026-01-01",
		postedAt: "2026-01-01",
		sequence,
		status: "posted",
		discardedAt: null,
		...overrides,
	};
}
const journal = (journalId: string, entries: Any[], reversesJournalId: string | null = null) => ({
	journalId,
	entries: entries.map((e) => ({ ...e, journalId })),
	reversesJournalId,
	createdAt: "2026-01-01",
});
/** A balanced pair: one debit and one credit of the same amount and currency. */
const balancedPair = (over: Record<string, unknown> = {}) => [
	entry({ direction: "debit", accountId: "acct-1", ...over }),
	entry({ direction: "credit", accountId: "acct-2", ...over }),
];

test("balanceAsOf honours BOTH clocks: an entry posted later is invisible to an earlier knownAt", () => {
	// The bitemporal core. A backdated correction — effective on the 1st, posted on the 5th — must be invisible to
	// "what did we know on the 3rd?" and visible to "what do we know on the 5th?". An implementation filtering
	// only on effectiveAt returns the same number for both, and passes any single-date fixture.
	const store = createLedgerStore();
	store.postJournal(journal("j1", balancedPair({ effectiveAt: "2026-01-01", postedAt: "2026-01-01" })));
	store.postJournal(journal("j2", balancedPair({ effectiveAt: "2026-01-01", postedAt: "2026-01-05" })));

	const knownEarly = balanceAsOf(store, "acct-1", "USD", "2026-01-31", "2026-01-03");
	const knownLate = balanceAsOf(store, "acct-1", "USD", "2026-01-31", "2026-01-05");
	assert.equal(knownEarly, 100n, `as of knownAt 01-03 only the first journal was known; got ${knownEarly}`);
	assert.equal(knownLate, 200n, `as of knownAt 01-05 the backdated journal is known too; got ${knownLate}`);
});

test("balanceAsOf excludes entries effective AFTER the requested effective date", () => {
	// The other clock, in isolation, so a failure names which one is wrong.
	const store = createLedgerStore();
	store.postJournal(journal("j1", balancedPair({ effectiveAt: "2026-01-01", postedAt: "2026-01-01" })));
	store.postJournal(journal("j2", balancedPair({ effectiveAt: "2026-02-01", postedAt: "2026-01-01" })));

	assert.equal(balanceAsOf(store, "acct-1", "USD", "2026-01-15", "2026-12-31"), 100n, "a future-effective entry leaked into an earlier as-of balance");
});

test("a discarded entry stays visible to a knownAt BEFORE it was discarded", () => {
	// `discardedAt IS NULL OR discardedAt > knownAt` is the subtlest clause in the contract, and the one that makes
	// history reproducible: a reversal recorded on the 10th must not rewrite what the books said on the 5th.
	const store = createLedgerStore();
	const original = balancedPair({ effectiveAt: "2026-01-01", postedAt: "2026-01-01" }).map((e) => ({
		...e,
		discardedAt: "2026-01-10",
	}));
	store.postJournal(journal("j1", original));

	assert.equal(balanceAsOf(store, "acct-1", "USD", "2026-01-31", "2026-01-05"), 100n, "a later reversal retroactively changed an earlier as-of balance");
	assert.equal(balanceAsOf(store, "acct-1", "USD", "2026-01-31", "2026-01-15"), 0n, "the discard was ignored at a knownAt after it happened");
});

test("a reversal ADDS a compensating entry — the original survives in the log", () => {
	// The immutability claim, and the one a balance assertion alone can never make. A store that deletes or
	// mutates the original produces exactly the right balance and destroys the audit trail.
	const store = createLedgerStore();
	store.postJournal(journal("j1", balancedPair()));
	const afterPost = store.allEntries().length;
	// A true compensating journal FLIPS each side (debit↔credit); forcing both entries to one direction would be
	// unbalanced and rejected, which is a different test entirely.
	const reversal = [
		entry({ direction: "credit", accountId: "acct-1" }),
		entry({ direction: "debit", accountId: "acct-2" }),
	];
	store.postJournal(journal("j2", reversal, "j1"));

	const all = store.allEntries();
	assert.ok(all.length > afterPost, "the reversal did not ADD entries — the log shrank or stood still");
	assert.ok(
		all.some((e: Any) => e.journalId === "j1"),
		"the original journal's entries are gone from the log — a reversal deleted history instead of compensating it",
	);
});

test("balanceOf is a pure FOLD — reading it twice cannot change it", () => {
	// The spec calls the balance "a pure fold over never-mutated entries". A cached balance updated on read, or a
	// fold that consumes an iterator, satisfies a single call and drifts on the second.
	const store = createLedgerStore();
	store.postJournal(journal("j1", balancedPair()));
	const first = balanceOf(store, "acct-1", "USD");
	assert.equal(balanceOf(store, "acct-1", "USD"), first, "reading the balance twice returned two values");
	assert.equal(balanceOf(store, "acct-1", "USD"), first, "the third read disagreed with the first two");
});

test("an unbalanced journal is REJECTED, and rejecting it leaves the ledger untouched", () => {
	// Composed on purpose: the visible acceptance checks the validator in isolation. What matters to the ledger is
	// that a rejected post is atomic — a store that appends entries and then throws leaves a permanently
	// unbalanced book, which is the invariant the whole project rests on.
	const store = createLedgerStore();
	store.postJournal(journal("j1", balancedPair()));
	const before = balanceOf(store, "acct-1", "USD");
	const lengthBefore = store.allEntries().length;

	assert.equal(validateJournalBalance([entry({ direction: "debit", amount: 50n })]).ok, false, "a one-sided journal validated as balanced");
	assert.throws(() => store.postJournal(journal("j-bad", [entry({ direction: "debit", amount: 50n })])), "an unbalanced journal was accepted");
	assert.equal(store.allEntries().length, lengthBefore, "the rejected journal left entries behind — the post was not atomic");
	assert.equal(balanceOf(store, "acct-1", "USD"), before, "a rejected journal moved the balance");
});

test("across the WHOLE history, debits equal credits for every currency", () => {
	// The project's stated spine, asserted over the full log rather than per journal — where a per-journal check
	// passes and a store that drops or duplicates an entry on append still breaks conservation.
	const store = createLedgerStore();
	store.postJournal(journal("j1", balancedPair({ currency: "USD" })));
	store.postJournal(journal("j2", balancedPair({ currency: "EUR", amount: 250n })));
	store.postJournal(journal("j3", balancedPair({ currency: "USD", amount: 75n })));

	const net = new Map<string, bigint>();
	for (const e of store.allEntries()) {
		const delta = e.direction === "debit" ? e.amount : -e.amount;
		net.set(e.currency, (net.get(e.currency) ?? 0n) + delta);
	}
	for (const [currency, sum] of net) {
		assert.equal(sum, 0n, `conservation broken for ${currency}: debits minus credits is ${sum}, not zero`);
	}
});
