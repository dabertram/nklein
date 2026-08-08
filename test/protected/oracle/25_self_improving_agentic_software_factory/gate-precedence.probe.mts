/**
 * P20.2 / P23.5 held-out oracle probe — SAFETY PRECEDENCE in the self-modification gate (project 25).
 *
 * ── A THIRTEENTH INVARIANT FAMILY: which rule wins when several apply ──
 * This is the gate a self-improving system passes its own changes through, so its ORDERING is the safety
 * property. The spec fixes it: immutable core is rejected first, then guardrail regressions block, then missing
 * human approval blocks, and only then is a change promoted.
 *
 * The spec's three visible tests each exercise exactly ONE rule in isolation — a plain immutable-core change, a
 * plain guardrail regression, a clean approved improvement. None of them puts two rules in tension, so a gate
 * that checks the rules in the WRONG ORDER passes all three. The dangerous inversion is concrete: a change that
 * touches the integrity firewall, improves every score, and carries human approval must STILL be rejected. A
 * gate that promotes on "approved and improving" before checking the core is exactly how a self-improving system
 * edits its own safety rails.
 *
 * Every probe here therefore stacks conditions rather than testing one.
 *
 * Binds only to the spec's prescribed module (`src/regression-gate/regression-gate.ts`).
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

const CANDIDATES = ["src/regression-gate/regression-gate.ts", "src/regression-gate.ts", "src/index.ts"];
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
const runRegressionGate = exported<(opts: Any) => { decision: string; reason: string }>("runRegressionGate");
const touchesImmutableCore = exported<(change: Any) => boolean>("touchesImmutableCore");

const change = (diff: string, over: Record<string, unknown> = {}) => ({
	id: "c1",
	diff,
	predictedImpact: "better",
	rollbackPath: "revert-c1",
	targetFailureCluster: "context-starvation",
	rubricVersion: "v1",
	...over,
});
const CORE_DIFF = "--- a/src/compiler/integrity-firewall.ts\n+++ b/src/compiler/integrity-firewall.ts\n+// tweak\n";
const SAFE_DIFF = "--- a/src/context/compressor.ts\n+++ b/src/context/compressor.ts\n+// tweak\n";

/** One run's scores across the two dimensions these probes care about. */
const scores = (target: number, security: number) => ({
	subScores: [
		{ dimension: "context-starvation", value: target, evidence: [], confidence: 1 },
		{ dimension: "security-posture", value: security, evidence: [], confidence: 1 },
	],
	total: target + security,
	rubricVersion: "v1",
});

test("an immutable-core change is rejected EVEN IF it improves everything and is human-approved", () => {
	// THE probe. Each visible test exercises one rule alone, so a gate that evaluates approval or improvement
	// first passes all three — and then lets a self-improving system edit its own integrity firewall, because the
	// change looked good and a human clicked yes.
	const result = runRegressionGate({
		change: change(CORE_DIFF),
		baselineScores: [scores(0.7, 0.9)],
		newScores: [scores(0.95, 0.99)],
		requiresHumanApproval: true,
		humanApproved: true,
	});
	assert.equal(
		result.decision,
		"auto-rejected-immutable-core",
		`an approved, strictly-improving change to the integrity firewall was ${result.decision} — immutable core does not take precedence`,
	);
});

test("an immutable-core change is rejected even when a guardrail ALSO regressed", () => {
	// The two blocking rules in tension. Either answer is "not promoted", but the spec fixes WHICH — and a gate
	// that reports "blocked" here has its precedence inverted, which is only visible once both conditions hold.
	const result = runRegressionGate({
		change: change(CORE_DIFF),
		baselineScores: [scores(0.7, 0.9)],
		newScores: [scores(0.8, 0.5)],
		requiresHumanApproval: false,
		humanApproved: false,
	});
	assert.equal(result.decision, "auto-rejected-immutable-core", "a guardrail regression outranked the immutable core");
});

test("human approval does NOT override a guardrail regression", () => {
	// The second inversion: approval is a gate, not a bypass. The visible suite never approves a regressing
	// change, so a gate that returns "promoted" as soon as a human says yes satisfies it.
	const result = runRegressionGate({
		change: change(SAFE_DIFF),
		baselineScores: [scores(0.7, 0.9)],
		newScores: [scores(0.85, 0.6)],
		requiresHumanApproval: true,
		humanApproved: true,
	});
	assert.notEqual(result.decision, "promoted", "an approved change that regressed a guardrail was promoted");
});

test("a regression in ANY SINGLE RUN blocks, even when the average still improves", () => {
	// The spec says "if any NEW score is lower than BASELINE for any run". A gate comparing AVERAGES passes every
	// fixture whose mean holds, and lets through exactly the intermittent security regression that matters most.
	const result = runRegressionGate({
		change: change(SAFE_DIFF),
		baselineScores: [scores(0.7, 0.9), scores(0.7, 0.9), scores(0.7, 0.9)],
		// The averages must IMPROVE (0.9 → 0.9167) while run 2 regresses, or an average-comparing gate blocks for
		// the wrong reason and the probe proves nothing. Verified against a per-run reference and an averaging one.
		newScores: [scores(0.8, 1.0), scores(0.8, 0.75), scores(0.8, 1.0)],
		requiresHumanApproval: false,
		humanApproved: false,
	});
	assert.notEqual(
		result.decision,
		"promoted",
		"a security regression in one of three runs was averaged away and the change was promoted",
	);
});

test("a clean, approved improvement is promoted — the gate is not simply refusing everything", () => {
	// The other direction. A gate that blocks unconditionally passes every safety probe above and is useless.
	const result = runRegressionGate({
		change: change(SAFE_DIFF),
		baselineScores: [scores(0.7, 0.9)],
		newScores: [scores(0.85, 0.9)],
		requiresHumanApproval: true,
		humanApproved: true,
	});
	assert.equal(result.decision, "promoted", `a clean approved improvement was ${result.decision}`);
});

test("touchesImmutableCore recognises EVERY protected path, not just the first", () => {
	// The list has three entries and the visible test names one. A check written against that single example
	// leaves the audit log and the gate itself editable — the two paths a system would most want to change.
	for (const path of ["src/compiler/integrity-firewall.ts", "src/regression-gate/regression-gate.ts", "src/trace/trace-store.ts"]) {
		assert.equal(
			touchesImmutableCore(change(`--- a/${path}\n+++ b/${path}\n+// tweak\n`)),
			true,
			`an immutable core path was not protected: ${path}`,
		);
	}
	assert.equal(touchesImmutableCore(change(SAFE_DIFF)), false, "an ordinary path was treated as immutable core");
});
