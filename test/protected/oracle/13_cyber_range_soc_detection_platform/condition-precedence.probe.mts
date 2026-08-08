/**
 * P20.2 / P23.5 held-out oracle probe — BOOLEAN OPERATOR PRECEDENCE in the rule condition (project 13).
 *
 * ── A SEVENTEENTH INVARIANT FAMILY: an expression whose meaning depends on binding, not on the tokens ──
 * `evaluateCondition("sel1 OR sel2 AND sel3", results)` has exactly one correct answer, and it is not the
 * left-to-right one. AND binds tighter than OR, so the expression means `sel1 OR (sel2 AND sel3)`. A naive
 * evaluator folding left to right computes `(sel1 OR sel2) AND sel3` and agrees with the correct one on every
 * single-operator fixture — which is what a hand-written test uses.
 *
 * The consequence here is not cosmetic. This is a DETECTION engine: a mis-bound condition changes which alerts
 * fire, and the failure is silent in both directions. A rule written as "suspicious process OR (parent is
 * explorer AND command line contains -enc)" degrades into something that only fires when the last clause holds,
 * so the broad detection quietly stops working while the suite stays green.
 *
 * `evaluateCondition` takes a string and a results map, so every probe here is pure — no event fixtures, no
 * normalizer, nothing but the expression semantics the spec fixes.
 *
 * Binds only to the spec's prescribed module (`src/rule-evaluator.ts`).
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

const CANDIDATES = ["src/rule-evaluator.ts", "src/detection/rule-evaluator.ts", "src/index.ts"];
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

const evaluateCondition = exported<(expr: string, results: Record<string, boolean>) => boolean>("evaluateCondition");

const R = (over: Record<string, boolean>) => ({ a: false, b: false, c: false, ...over });

test("AND binds tighter than OR — the single most consequential precedence rule", () => {
	// `a OR b AND c` is `a OR (b AND c)`. With a=true, b=true, c=false the correct answer is TRUE; a left-to-right
	// evaluator computes `(a OR b) AND c` = FALSE. Every single-operator fixture agrees with both.
	assert.equal(
		evaluateCondition("a OR b AND c", R({ a: true, b: true, c: false })),
		true,
		"'a OR b AND c' was evaluated as '(a OR b) AND c' — AND must bind tighter than OR",
	);
	// The mirror case, where the naive evaluator answers TRUE and the correct one FALSE.
	assert.equal(
		evaluateCondition("a AND b OR c", R({ a: false, b: true, c: false })),
		false,
		"'a AND b OR c' was evaluated as 'a AND (b OR c)' — AND must bind tighter than OR",
	);
});

test("NOT is unary and binds tighter than AND", () => {
	// `NOT a AND b` is `(NOT a) AND b`. An evaluator applying NOT to the whole remaining expression gets
	// `NOT (a AND b)`, which with a=false, b=false differs: correct FALSE, naive TRUE.
	assert.equal(
		evaluateCondition("NOT a AND b", R({ a: false, b: false })),
		false,
		"'NOT a AND b' was evaluated as 'NOT (a AND b)' — NOT is unary and binds tighter than AND",
	);
	assert.equal(evaluateCondition("NOT a AND b", R({ a: false, b: true })), true, "'(NOT a) AND b' should be true here");
	assert.equal(evaluateCondition("NOT a", R({ a: true })), false, "plain NOT is wrong");
});

test("parentheses OVERRIDE precedence, in both directions", () => {
	// The paired case: the same tokens, one parenthesised, must give different answers. An evaluator that ignores
	// parentheses entirely — or one that is left-to-right and therefore accidentally right on the parenthesised
	// form — is caught only by requiring the two to DIFFER.
	const results = R({ a: true, b: true, c: false });
	assert.equal(evaluateCondition("(a OR b) AND c", results), false, "'(a OR b) AND c' should be false here");
	assert.equal(evaluateCondition("a OR b AND c", results), true, "'a OR b AND c' should be true here");
	assert.notEqual(
		evaluateCondition("(a OR b) AND c", results),
		evaluateCondition("a OR b AND c", results),
		"parenthesising changed nothing — the parser ignores parentheses",
	);
});

test("nested parentheses and a parenthesised NOT are handled", () => {
	assert.equal(evaluateCondition("NOT (a OR b)", R({ a: false, b: false })), true, "'NOT (a OR b)' is wrong");
	assert.equal(evaluateCondition("NOT (a OR b)", R({ a: true, b: false })), false, "'NOT (a OR b)' is wrong");
	assert.equal(
		evaluateCondition("(a AND (b OR c))", R({ a: true, b: false, c: true })),
		true,
		"nested parentheses are not handled",
	);
});

test("a single selection id, with no operators, evaluates to its own value", () => {
	// The degenerate case a real rule uses constantly. A parser that requires an operator throws or returns
	// undefined here, and every rule with one selection stops firing.
	assert.equal(evaluateCondition("a", R({ a: true })), true, "a bare selection id did not evaluate to its value");
	assert.equal(evaluateCondition("a", R({ a: false })), false, "a bare selection id did not evaluate to its value");
});

test("evaluation is a pure function of the inputs — repeating a call cannot change it", () => {
	// A tokenizer holding module-level state (an index, a regex with lastIndex, a cached AST keyed loosely)
	// answers differently on the second call. Same statelessness class as project 24, different mechanism.
	const expr = "a OR b AND NOT c";
	const results = R({ a: false, b: true, c: false });
	const first = evaluateCondition(expr, results);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		assert.equal(evaluateCondition(expr, results), first, `call ${attempt + 2} disagreed with the first`);
	}
	assert.equal(first, true, "'a OR (b AND (NOT c))' should be true here");
});
