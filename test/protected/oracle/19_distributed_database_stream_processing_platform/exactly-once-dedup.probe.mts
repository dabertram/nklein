/**
 * P20.2 / P23.5 held-out oracle probe — EXACTLY-ONCE client deduplication (project 19).
 *
 * ── A NINTH INVARIANT FAMILY: identity, not arithmetic ──
 * The dedup store is what makes a retried client request apply once rather than twice. Its correctness rests on
 * a COMPOSITE identity — (clientId, requestSeq) — and the spec's three visible acceptance checks all use the
 * SAME client `c1`. A store keyed on `requestSeq` alone therefore passes every one of them, and then hands
 * client 2 the result of client 1's request with the same sequence number. In a banking or ledger workload that
 * is not a subtle bug; it is one client seeing another's data, and a retry applying the wrong command.
 *
 * So these probes are all multi-client and interleaved. None of them repeats the single-client shape the visible
 * suite already covers.
 *
 * ── ONE THING DELIBERATELY NOT ASSERTED ──
 * `getResult` returns `unknown | null`, so a command whose legitimate result IS null cannot be distinguished
 * from "never seen" — an exactly-once hole that lives in the INTERFACE, not in any implementation of it. A probe
 * for it would fail every conforming workspace, which would make this oracle a judge of the spec rather than of
 * the agent. It is recorded here instead, where a human can decide whether the interface should change.
 *
 * Binds only to the spec's prescribed module (`src/raft/client-dedup.ts`).
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

const CANDIDATES = ["src/raft/client-dedup.ts", "src/raft/dedup.ts", "src/index.ts"];
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
type Store = any;
const createClientDedupStore = exported<() => Store>("createClientDedupStore");

test("two clients using the SAME sequence number never see each other's result", () => {
	// THE probe. Every visible acceptance check uses client c1, so a store keyed on requestSeq alone passes them
	// all — and then returns c1's result to c2. That is one client reading another's data, and a retry applying
	// the wrong command.
	const store = createClientDedupStore();
	store.recordResult("c1", 1, "result-for-c1");

	assert.equal(
		store.getResult("c2", 1),
		null,
		"client c2 was handed client c1's result — the store is keyed on the sequence number alone, not on (clientId, requestSeq)",
	);
	store.recordResult("c2", 1, "result-for-c2");
	assert.equal(store.getResult("c1", 1), "result-for-c1", "recording c2 overwrote c1's result at the same seq");
	assert.equal(store.getResult("c2", 1), "result-for-c2");
});

test("many clients interleaved keep their own histories intact", () => {
	// The single-client fixture cannot expose a store that keeps only the most recent client, or one whose inner
	// map is shared by reference across clients. Interleaving is what separates those from a correct store.
	const store = createClientDedupStore();
	const clients = ["alpha", "beta", "gamma"];
	for (let seq = 1; seq <= 20; seq += 1) {
		for (const client of clients) {
			store.recordResult(client, seq, `${client}:${seq}`);
		}
	}
	for (let seq = 1; seq <= 20; seq += 1) {
		for (const client of clients) {
			assert.equal(store.getResult(client, seq), `${client}:${seq}`, `lost the result for ${client} at seq ${seq}`);
		}
	}
});

test("an unseen sequence returns null even for a client the store already knows", () => {
	// A store that answers "has this client been seen?" rather than "has this REQUEST been seen?" dedups a brand
	// new command as if it were a retry — the exactly-once guarantee inverted into never-once.
	const store = createClientDedupStore();
	store.recordResult("c1", 1, "first");
	assert.equal(store.getResult("c1", 2), null, "an unseen sequence was treated as already applied");
	assert.equal(store.getResult("c1", 0), null, "a sequence below the recorded one was treated as already applied");
});

test("out-of-order sequences are each remembered independently", () => {
	// Sequences are monotonic per client in the happy path, but retries and reordering mean a store must not
	// assume arrival order. One that keeps only the HIGHEST seq passes any in-order fixture and forgets the rest.
	const store = createClientDedupStore();
	store.recordResult("c1", 5, "five");
	store.recordResult("c1", 3, "three");
	store.recordResult("c1", 9, "nine");
	assert.equal(store.getResult("c1", 3), "three", "an out-of-order lower sequence was dropped");
	assert.equal(store.getResult("c1", 5), "five", "a middle sequence was dropped");
	assert.equal(store.getResult("c1", 9), "nine");
	assert.equal(store.getResult("c1", 4), null, "a never-recorded sequence between two recorded ones returned a result");
});

test("a repeated retry returns the SAME result every time, not just the first", () => {
	// Exactly-once is a claim about every retry, not the second one. A store that clears an entry on read — a
	// plausible "consume the dedup token" design — satisfies a two-call fixture and re-applies on the third.
	const store = createClientDedupStore();
	store.recordResult("c1", 7, { ok: true, balance: 100 });
	for (let attempt = 0; attempt < 5; attempt += 1) {
		assert.deepEqual(
			store.getResult("c1", 7),
			{ ok: true, balance: 100 },
			`retry ${attempt + 1} did not return the recorded result — the entry is consumed on read`,
		);
	}
});

test("two stores are independent, so state cannot leak through module-level sharing", () => {
	// `createClientDedupStore()` is a factory. An implementation backed by a module-level Map returns the same
	// state to every caller, which passes every single-store test and silently merges two Raft groups' histories.
	const first = createClientDedupStore();
	const second = createClientDedupStore();
	first.recordResult("c1", 1, "from-first");
	assert.equal(second.getResult("c1", 1), null, "a second store already knew the first store's request");
});
