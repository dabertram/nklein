/**
 * P20.2 / P23.5 held-out oracle probe — FSM COMPLEMENT and dual-definition agreement (project 05).
 *
 * ── A TWENTIETH INVARIANT FAMILY: what a state machine must REFUSE, and two functions that must not drift ──
 * The spec's visible acceptance is unusually thorough on one side: it requires "one expect per edge in EDGES
 * asserting ok:true", so every LEGAL transition is checked. What it checks on the other side is two spot cases.
 *
 * That asymmetry is the whole opening. An implementation returning `{ok: true}` for ANY pair satisfies every
 * legal-edge assertion and fails only the two named illegal ones — so getting those two right by accident, or
 * special-casing them, yields a state machine with no constraints at all. The complement is 81 − 23 = 58 pairs
 * (9 statuses, 23 published edges); this probe asserts every one of them, and asserts the COUNT so the
 * enumeration itself cannot silently shrink.
 *
 * The second property is dual-definition agreement. `transition` and `legalNextStatuses` describe the SAME
 * relation. Derived from one table they agree by construction; written separately they drift, and the drift is
 * invisible because each function looks right on its own. The failure payload's `legalTransitions` is a third
 * copy of the same fact, so it is checked against the other two.
 *
 * Binds only to the spec's prescribed module (`src/core/unit-fsm.ts`).
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

const CANDIDATES = ["src/core/unit-fsm.ts", "src/core/fsm.ts", "src/index.ts"];
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
const transition = exported<(current: string, next: string) => Any>("transition");
const legalNextStatuses = exported<(current: string) => string[]>("legalNextStatuses");

/** The adjacency table the spec publishes verbatim — ground truth, not an interpretation of it. */
const EDGES: Record<string, string[]> = {
	available: ["dispatched", "out_of_service"],
	dispatched: ["en_route", "available", "out_of_service"],
	en_route: ["staged", "on_scene", "out_of_service"],
	staged: ["on_scene", "available", "out_of_service"],
	on_scene: ["transporting", "available", "out_of_service"],
	transporting: ["at_destination", "out_of_service"],
	at_destination: ["available", "clear", "out_of_service"],
	out_of_service: ["available", "clear"],
	clear: ["available", "dispatched"],
};
const STATUSES = Object.keys(EDGES);

test("EVERY pair outside the table is refused — all 58 of them, not the two the spec names", () => {
	// The visible suite asserts every LEGAL edge and exactly two illegal ones. An implementation returning ok:true
	// for anything passes all of the former and can be made to pass the latter by special-casing two pairs, and is
	// then a state machine with no constraints. Only the exhaustive complement closes that.
	let checked = 0;
	for (const current of STATUSES) {
		for (const next of STATUSES) {
			if (EDGES[current]?.includes(next)) {
				continue;
			}
			checked += 1;
			const result = transition(current, next);
			assert.equal(result.ok, false, `${current} → ${next} was ALLOWED but is not in the transition table`);
		}
	}
	// The count is derived, not remembered: 9 statuses squared, minus the 23 edges the table publishes. It is
	// asserted because an enumeration that quietly skips rows would otherwise pass while checking almost nothing.
	const expectedIllegal = STATUSES.length ** 2 - Object.values(EDGES).reduce((total, list) => total + list.length, 0);
	assert.equal(checked, expectedIllegal, `expected ${expectedIllegal} illegal pairs; enumerated ${checked}`);
	assert.equal(expectedIllegal, 58, "the published table no longer has 23 edges over 9 statuses");
});

test("no status may transition to ITSELF — a self-loop hides a unit that never moves", () => {
	// Included explicitly because it is the illegal pair most likely to be waved through by a permissive default,
	// and an idle unit that keeps "transitioning" to its own status looks active on every dashboard.
	for (const status of STATUSES) {
		assert.equal(transition(status, status).ok, false, `${status} → ${status} was allowed`);
	}
});

test("transition and legalNextStatuses never disagree", () => {
	// Two functions, one relation. Derived from a single table they agree by construction; maintained separately
	// they drift, and each looks correct in isolation — so only cross-checking them can find it.
	for (const current of STATUSES) {
		const advertised = new Set(legalNextStatuses(current));
		for (const next of STATUSES) {
			const accepted = transition(current, next).ok === true;
			assert.equal(
				accepted,
				advertised.has(next),
				accepted
					? `transition allows ${current} → ${next} but legalNextStatuses(${current}) does not advertise it`
					: `legalNextStatuses(${current}) advertises ${next} but transition refuses it`,
			);
		}
	}
});

test("a refusal carries the SAME legal set the advertiser returns", () => {
	// The failure payload is a third copy of the same fact, and the one a caller actually shows an operator. A
	// refusal listing the wrong alternatives sends a dispatcher down a path the machine will refuse again.
	for (const current of STATUSES) {
		const illegal = STATUSES.find((s) => !EDGES[current]?.includes(s));
		if (!illegal) {
			continue;
		}
		const result = transition(current, illegal);
		assert.equal(result.ok, false);
		assert.deepEqual(
			[...(result.legalTransitions ?? [])].sort(),
			[...legalNextStatuses(current)].sort(),
			`the refusal for ${current} advertised a different legal set than legalNextStatuses(${current})`,
		);
	}
});

test("the published table is honoured exactly — every legal edge, and the right COUNT per status", () => {
	// The count is what catches a table that ADDS an edge. Asserting only "each published edge is allowed" cannot
	// see an extra one, and the exhaustive complement above would already fail — this names WHICH status widened.
	for (const [current, expected] of Object.entries(EDGES)) {
		for (const next of expected) {
			assert.equal(transition(current, next).ok, true, `${current} → ${next} is published as legal but was refused`);
		}
		assert.equal(
			legalNextStatuses(current).length,
			expected.length,
			`legalNextStatuses(${current}) returned ${legalNextStatuses(current).length} edges; the table publishes ${expected.length}`,
		);
	}
});

test("every status can still reach `available` — no state strands a unit", () => {
	// A liveness property no single-edge test can express: a table that is individually legal edge-by-edge can
	// still contain a sink from which a unit never returns to service. Computed from the IMPLEMENTATION's own
	// advertised edges, so it grades the workspace rather than re-checking the constant above.
	for (const start of STATUSES) {
		const seen = new Set<string>([start]);
		const queue = [start];
		let reached = start === "available";
		while (queue.length > 0 && !reached) {
			for (const next of legalNextStatuses(queue.shift() as string) ?? []) {
				if (next === "available") {
					reached = true;
					break;
				}
				if (!seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			}
		}
		assert.ok(reached, `a unit in '${start}' can never return to 'available' — that status is a sink`);
	}
});
