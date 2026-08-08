/**
 * P20.2 / P23.5 held-out oracle probe — TAINT MONOTONICITY (project 36).
 *
 * ── A TWENTY-EIGHTH INVARIANT FAMILY: a property that must survive ARBITRARY composition ──
 * The spec states the rule in its own type signatures: `mapTainted` "keeps trust (monotone)", `combineTainted`
 * takes "trust = weakest(a,b)", and `verify` is the "ONLY way to raise trust". That last clause is what makes
 * this checkable in a way a per-function test cannot reach: it is a claim about EVERY path through the module,
 * not about any single call.
 *
 * A per-function test shows that one `mapTainted` preserved trust once. What it cannot show is that no CHAIN of
 * maps and combines launders a low-trust value into a high-trust one — which is the only way the rule actually
 * gets broken, and the entire point of a taint system. So the probes drive long random-ish chains and assert
 * against the weakest input that ever entered them.
 *
 * Binds only to the spec's prescribed exports. Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const CANDIDATES = ["src/kernel/taint.ts", "src/kernel/trust.ts", "src/taint.ts", "src/trust.ts", "src/index.ts"];
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
const trustRank = exported<(t: Any) => number>("trustRank");
const meetsMin = exported<(value: Any, required: Any) => boolean>("meetsMin");
const weakest = exported<(a: Any, b: Any) => Any>("weakest");
const taint = exported<(value: Any, trust: Any, provenance: string) => Any>("taint");
const mapTainted = exported<(t: Any, f: (a: Any) => Any) => Any>("mapTainted");
const combineTainted = exported<(a: Any, b: Any, f: (a: Any, b: Any) => Any) => Any>("combineTainted");

/**
 * Trust level names are the workspace's to choose, so they are DISCOVERED rather than assumed: every level the
 * implementation ranks is used, and the probe grades the ORDER it declares rather than one I invented.
 */
const LEVELS = ["untrusted", "reported", "attested", "verified", "constitutional", "owner", "system", "trusted"].filter(
	(name) => Number.isFinite(trustRank(name)),
);
const rankOf = (tainted: Any) => trustRank(tainted?.trust ?? tainted);

test("the workspace declares a usable trust ORDER — at least two distinct ranks", () => {
	// Everything below is relative to the implementation's own ordering, so a degenerate ranking (all equal)
	// would make every later assertion vacuous. Caught here rather than silently passing.
	assert.ok(LEVELS.length >= 2, `only ${LEVELS.length} trust level(s) resolved — cannot grade an ordering`);
	assert.ok(new Set(LEVELS.map(trustRank)).size >= 2, "every trust level has the same rank — the lattice is flat");
});

test("mapTainted NEVER raises trust, at any level", () => {
	// The spec's own annotation says "keeps trust (monotone)". A per-function test shows one call preserved it;
	// this checks every level, including the transformation that would most tempt a re-taint.
	for (const level of LEVELS) {
		const before = taint(1, level, "probe");
		const after = mapTainted(before, (value: number) => value * 100);
		assert.ok(
			rankOf(after) <= rankOf(before),
			`mapTainted RAISED trust from ${level} (rank ${rankOf(before)}) to rank ${rankOf(after)} — only verify() may do that`,
		);
	}
});

test("combineTainted takes the WEAKEST of its inputs, in both argument orders", () => {
	// Two orderings of one question. An implementation taking the FIRST argument's trust is right half the time
	// and passes any fixture that happens to pass the weaker value first.
	for (const a of LEVELS) {
		for (const b of LEVELS) {
			const combined = combineTainted(taint(1, a, "p"), taint(2, b, "p"), (x: number, y: number) => x + y);
			const expected = Math.min(trustRank(a), trustRank(b));
			assert.equal(
				rankOf(combined),
				expected,
				`combineTainted(${a}, ${b}) gave rank ${rankOf(combined)}; the weakest of the two is ${expected}`,
			);
		}
	}
});

test("NO CHAIN of maps and combines can launder trust upward", () => {
	// THE probe, and the only one that tests the rule as stated — "verify is the ONLY way to raise trust" is a
	// claim about every path through the module, not about a single call. A chain is how laundering actually
	// happens: combine a tainted value with a trusted one, map it a few times, and see whether the taint survives.
	const lowest = LEVELS.reduce((worst, level) => (trustRank(level) < trustRank(worst) ? level : worst), LEVELS[0] as string);
	const highest = LEVELS.reduce((best, level) => (trustRank(level) > trustRank(best) ? level : best), LEVELS[0] as string);

	let current = taint(1, lowest, "probe");
	for (let step = 0; step < 25; step += 1) {
		current = mapTainted(current, (value: number) => value + 1);
		// ALTERNATE the argument order. With the tainted value always first, an implementation that simply keeps
		// the FIRST argument's trust is right by accident and the chain proves nothing — found by running exactly
		// that implementation, which passed this probe until the order started varying.
		const clean = taint(step, highest, "clean");
		current =
			step % 2 === 0
				? combineTainted(current, clean, (x: number, y: number) => x + y)
				: combineTainted(clean, current, (x: number, y: number) => x + y);
		current = mapTainted(current, (value: number) => value * 2);
		assert.ok(
			rankOf(current) <= trustRank(lowest),
			`after ${step + 1} map/combine rounds the value reached rank ${rankOf(current)}, above its weakest input (${lowest}, rank ${trustRank(lowest)}) — the chain launders taint`,
		);
	}
});

test("weakest is commutative and idempotent — it is a lattice meet, not a preference", () => {
	for (const a of LEVELS) {
		assert.equal(trustRank(weakest(a, a)), trustRank(a), `weakest(${a}, ${a}) is not ${a}`);
		for (const b of LEVELS) {
			assert.equal(
				trustRank(weakest(a, b)),
				trustRank(weakest(b, a)),
				`weakest(${a}, ${b}) and weakest(${b}, ${a}) disagree — the meet depends on argument order`,
			);
			assert.equal(trustRank(weakest(a, b)), Math.min(trustRank(a), trustRank(b)), `weakest(${a}, ${b}) is not the minimum`);
		}
	}
});

test("meetsMin agrees with trustRank for every pair — two definitions of one order", () => {
	// The same dual-definition check as project 05's FSM and project 12's ancestry: a predicate and a ranking
	// describing one relation, which drift apart invisibly because each looks right alone.
	for (const value of LEVELS) {
		for (const required of LEVELS) {
			assert.equal(
				meetsMin(value, required),
				trustRank(value) >= trustRank(required),
				`meetsMin(${value}, ${required}) disagrees with the ranks (${trustRank(value)} vs ${trustRank(required)})`,
			);
		}
	}
});
