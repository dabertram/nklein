/**
 * P20.2 / P23.5 held-out oracle probe — COLREGS RECIPROCITY (project 09).
 *
 * ── AN EIGHTEENTH INVARIANT FAMILY: two independent answers that must agree with each other ──
 * Every one of the spec's visible acceptance cases classifies an encounter from ONE vessel's point of view:
 * target on my starboard bow → I give way; target on my port bow → I stand on; and so forth. Each is
 * individually checkable and individually plausible.
 *
 * What none of them can check is the property the rule EXISTS for: the two vessels' answers must be
 * complementary. If I classify you as `CROSSING_GIVE_WAY`, you must classify me as `CROSSING_STAND_ON`. A
 * classifier with a sign error, or one that measures relative bearing against the wrong course, can produce two
 * perfectly reasonable-looking classifications in which **both vessels believe they are the stand-on vessel** —
 * and neither gives way. That is the collision the regulation is written to prevent, and it is invisible to
 * every single-vessel test.
 *
 * CPA gets the same treatment: the closest point of approach is a property of the PAIR, so `cpaNm(A, B)` must
 * equal `cpaNm(B, A)`. An implementation that computes it from one vessel's frame only is asymmetric.
 *
 * Binds only to the spec's prescribed module (`src/core/colregs.ts`).
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

const CANDIDATES = ["src/core/colregs.ts", "src/colregs.ts", "src/index.ts"];
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
const classifyEncounter = exported<(own: Any, target: Any, restricted: boolean) => Any>("classifyEncounter");

const track = (posLat: number, posLon: number, courseDegreesTrue: number, speedKts = 10) => ({
	posLat,
	posLon,
	courseDegreesTrue,
	speedKts,
});

/**
 * A genuine crossing: OWN steams north from the origin; TARGET lies to the north-east steaming west, so it
 * crosses ahead. Bearing to target is ~045° (own starboard bow ⇒ own gives way); bearing back to own is ~225°,
 * which against the target's 270° course is ~315° — its port side ⇒ the target stands on.
 */
const CROSSING_OWN = track(0, 0, 0);
const CROSSING_TARGET = track(0.1, 0.1, 270);

/** A genuine head-on: both on the same meridian, steaming directly at one another. */
const HEADON_OWN = track(0, 0, 0);
const HEADON_TARGET = track(0.1, 0, 180);

test("a crossing is COMPLEMENTARY — one vessel gives way, the OTHER stands on", () => {
	// THE probe. Both classifications are individually plausible; only comparing them can reveal a classifier in
	// which both vessels believe they are stand-on and neither gives way.
	const fromOwn = classifyEncounter(CROSSING_OWN, CROSSING_TARGET, false);
	const fromTarget = classifyEncounter(CROSSING_TARGET, CROSSING_OWN, false);

	assert.equal(fromOwn.encounterClass, "CROSSING_GIVE_WAY", `own vessel classified the crossing as ${fromOwn.encounterClass}`);
	assert.equal(
		fromTarget.encounterClass,
		"CROSSING_STAND_ON",
		`the target classified the same crossing as ${fromTarget.encounterClass} — both vessels cannot hold the same role`,
	);
	assert.notEqual(
		fromOwn.encounterClass,
		fromTarget.encounterClass,
		"both vessels reached the SAME conclusion about a crossing — if both stand on, nobody gives way",
	);
});

test("a head-on is MUTUAL — both vessels see the same class and both alter to starboard", () => {
	// The complement of the case above: head-on is the one encounter where agreement is correct, and a classifier
	// that always produces complementary answers (an over-correction) fails here rather than in the crossing.
	const fromOwn = classifyEncounter(HEADON_OWN, HEADON_TARGET, false);
	const fromTarget = classifyEncounter(HEADON_TARGET, HEADON_OWN, false);

	assert.equal(fromOwn.encounterClass, "HEAD_ON", `own vessel classified a head-on as ${fromOwn.encounterClass}`);
	assert.equal(fromTarget.encounterClass, "HEAD_ON", `the target classified the same head-on as ${fromTarget.encounterClass}`);
	for (const result of [fromOwn, fromTarget]) {
		assert.match(String(result.requiredAction), /starboard/i, "a head-on must direct BOTH vessels to alter to starboard");
	}
});

test("CPA is a property of the PAIR — it is identical from either vessel's frame", () => {
	// The closest point of approach is geometric and symmetric. An implementation that projects only the target's
	// motion relative to a stationary own vessel is asymmetric, and every single-vessel test still passes.
	const fromOwn = classifyEncounter(CROSSING_OWN, CROSSING_TARGET, false);
	const fromTarget = classifyEncounter(CROSSING_TARGET, CROSSING_OWN, false);
	assert.ok(
		Math.abs(Number(fromOwn.cpaNm) - Number(fromTarget.cpaNm)) < 1e-6,
		`CPA differs by vessel: ${fromOwn.cpaNm} vs ${fromTarget.cpaNm} — it is a property of the pair, not of the observer`,
	);
	assert.ok(
		Math.abs(Number(fromOwn.tcpaHrs) - Number(fromTarget.tcpaHrs)) < 1e-6,
		`TCPA differs by vessel: ${fromOwn.tcpaHrs} vs ${fromTarget.tcpaHrs}`,
	);
});

test("restricted visibility overrides the class for BOTH vessels, not just the one asking", () => {
	// The spec makes Rule 19 an override. Applying it on one side only leaves the other vessel manoeuvring under
	// crossing rules against a vessel that is no longer playing by them.
	for (const [a, b] of [
		[CROSSING_OWN, CROSSING_TARGET],
		[CROSSING_TARGET, CROSSING_OWN],
		[HEADON_OWN, HEADON_TARGET],
	]) {
		const result = classifyEncounter(a, b, true);
		assert.equal(result.encounterClass, "RESTRICTED_VISIBILITY", "restricted visibility did not override the class");
		assert.match(String(result.requiredAction), /own action/i, "Rule 19 requires 'safe speed / own action'");
	}
});

test("the classifier is TOTAL and self-consistent under repetition", () => {
	// The spec requires exactly one class per pair with no throw. Repetition additionally guards a classifier
	// holding state between calls — the same statelessness class seen in project 24.
	const VALID = new Set(["HEAD_ON", "CROSSING_GIVE_WAY", "CROSSING_STAND_ON", "OVERTAKING", "RESTRICTED_VISIBILITY"]);
	const pairs = [
		[CROSSING_OWN, CROSSING_TARGET],
		[CROSSING_TARGET, CROSSING_OWN],
		[HEADON_OWN, HEADON_TARGET],
		[track(0, 0, 0), track(-0.1, 0, 0)], // target astern, same course — an overtaking geometry
		[track(0, 0, 90), track(0, 0.1, 90)], // target dead ahead, same course
	];
	for (const [a, b] of pairs) {
		const first = classifyEncounter(a, b, false);
		assert.ok(VALID.has(String(first.encounterClass)), `not a valid EncounterClass: ${first.encounterClass}`);
		assert.ok(String(first.bindingRule).length > 0, "no binding rule was cited");
		for (let attempt = 0; attempt < 3; attempt += 1) {
			assert.equal(
				classifyEncounter(a, b, false).encounterClass,
				first.encounterClass,
				"the same pair classified differently on a repeated call",
			);
		}
	}
});
