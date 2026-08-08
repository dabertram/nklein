/**
 * P20.2 / P23.5 held-out oracle probe — FOG-OF-WAR LEAKAGE (project 34).
 *
 * ── A TWENTY-FIFTH INVARIANT FAMILY: what a consumer must NOT be told ──
 * The Observation is the only thing an LLM commander sees, and the spec is explicit that ground truth must
 * never reach it. That makes this an information-hiding boundary rather than a computation: a leak does not
 * make the game crash or look wrong, it makes the AI play with perfect information while behaving entirely
 * plausibly. Nothing downstream can detect it.
 *
 * The spec's visible acceptance checks ONE FIELD — that a hidden enemy is absent from `visibleUnits`. An
 * Observation carries five other fields, any of which can carry the same unit: a `fogState` serialised with per-
 * cell occupancy, a ghost list built from live data, a resource list unfiltered. So the probe asserts on the
 * SERIALISED WHOLE, which is the only check that covers fields nobody thought about — the same reasoning that
 * made project 24's redaction probe assert over the redacted output rather than the input.
 *
 * The second probe is the sharper one. A ghost must hold the LAST KNOWN position. An implementation that builds
 * ghosts by reading ground truth at observation time passes every fixture where the enemy stands still, and
 * silently gives the commander live tracking of units it cannot see. So the enemy MOVES after leaving sight.
 *
 * Binds only to the spec's prescribed modules. Runs via the HOST's tsx; workspace via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const CANDIDATES = ["src/sim/fog.ts", "src/sim/observation.ts", "src/sim/match.ts", "src/sim/map.ts", "src/index.ts"];
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
const createMapGrid = exported<(w: number, h: number) => Any>("createMapGrid");
const createUnit = exported<(id: Any, owner: Any, type: Any, startTile: number, grid: Any) => Any>("createUnit");
const createMatchState = exported<(seed: Any, map: Any, units: Any[]) => Any>("createMatchState");
const computeFogState = exported<(playerId: Any, units: Any[], map: Any, sightRange: number) => Any>("computeFogState");
const buildObservation =
	exported<(playerId: Any, groundTruth: Any, fog: Any, tick: number, decoys: Any[]) => Any>("buildObservation");

const WIDTH = 12;
const HEIGHT = 12;
const SIGHT = 2;
const tile = (x: number, y: number) => y * WIDTH + x;

/** Own scout at the top-left; the enemy starts far away, well outside sight range. */
function scene(enemyTile: number) {
	const map = createMapGrid(WIDTH, HEIGHT);
	const own = createUnit(1, "p1", "scout", tile(1, 1), map);
	const enemy = createUnit(2, "p2", "scout", enemyTile, map);
	const state = createMatchState(1n, map, [own, enemy]);
	const fog = computeFogState("p1", [own], map, SIGHT);
	return { map, own, enemy, state, fog };
}

test("a hidden enemy appears NOWHERE in the observation, not merely outside visibleUnits", () => {
	// THE probe. The visible acceptance checks one field; an Observation has six, and a leak through fogState, a
	// ghost list built from live data, or an unfiltered resource list is exactly as damaging and entirely
	// invisible to a single-field assertion. Serialising the whole thing is the only check that covers the fields
	// nobody enumerated.
	const { state, fog } = scene(tile(10, 10));
	const observation = buildObservation("p1", state, fog, 1, []);
	const serialised = JSON.stringify(observation);

	assert.ok(serialised.length > 0, "buildObservation returned nothing serialisable");
	assert.ok(
		!serialised.includes('"tileIndex":130') && !serialised.includes(String(tile(10, 10))),
		`the hidden enemy's tile (${tile(10, 10)}) appears somewhere in the observation — a field other than visibleUnits is leaking ground truth`,
	);
});

test("a GHOST holds the last-seen position, not the enemy's live one", () => {
	// The sharper probe. Every fixture where the enemy stands still passes on an implementation that reads ground
	// truth at observation time — and that implementation hands the commander live tracking of a unit it cannot
	// see. Moving the enemy AFTER it leaves sight is the only way to tell the two apart.
	const map = createMapGrid(WIDTH, HEIGHT);
	const own = createUnit(1, "p1", "scout", tile(5, 5), map);
	const seenAt = tile(6, 5); // adjacent — inside SIGHT
	const enemy = createUnit(2, "p2", "scout", seenAt, map);

	// Tick 1: the enemy is visible.
	const fogSeen = computeFogState("p1", [own], map, SIGHT);
	const first = buildObservation("p1", createMatchState(1n, map, [own, enemy]), fogSeen, 1, []);
	assert.ok(JSON.stringify(first).includes(String(seenAt)), "the enemy was not visible when it stood in sight range");

	// Tick 2: the enemy has walked far away. The cell it was seen in is now merely "explored".
	const movedEnemy = { ...enemy, tileIndex: tile(11, 11) };
	const second = buildObservation("p1", createMatchState(1n, map, [own, movedEnemy]), fogSeen, 2, []);
	const ghosts = second.lastKnownGhosts ?? [];
	const ghost = ghosts.find((g: Any) => String(g.id) === String(enemy.id ?? 2));

	if (ghost) {
		assert.equal(
			Number(ghost.tileIndex),
			seenAt,
			`the ghost reports tile ${ghost.tileIndex}, the enemy's CURRENT position — a ghost must hold the last SEEN position (${seenAt})`,
		);
	}
	assert.ok(
		!JSON.stringify(second).includes(String(tile(11, 11))),
		"the enemy's new, unseen position leaked into the observation",
	);
});

test("own units are always present, so the filter is not simply removing everything", () => {
	// The complement. An observation that hides everything passes every leak assertion and is useless.
	const { state, fog, own } = scene(tile(10, 10));
	const observation = buildObservation("p1", state, fog, 1, []);
	const ownIds = (observation.ownUnits ?? []).map((u: Any) => String(u.id));
	assert.ok(ownIds.includes(String(own.id ?? 1)), "the player's own unit is missing from its own observation");
});

test("an enemy INSIDE sight range is reported — the filter is not blanket-hiding enemies", () => {
	const map = createMapGrid(WIDTH, HEIGHT);
	const own = createUnit(1, "p1", "scout", tile(5, 5), map);
	const enemy = createUnit(2, "p2", "scout", tile(6, 5), map);
	const fog = computeFogState("p1", [own], map, SIGHT);
	const observation = buildObservation("p1", createMatchState(1n, map, [own, enemy]), fog, 1, []);
	const visibleIds = (observation.visibleUnits ?? []).map((u: Any) => String(u.id));
	assert.ok(visibleIds.includes(String(enemy.id ?? 2)), "an enemy standing in a visible cell was not reported");
});

test("two observations of the same state are identical — determinism, byte for byte", () => {
	// The spec requires it, and repetition also guards a builder holding state between calls.
	const { state, fog } = scene(tile(10, 10));
	const first = JSON.stringify(buildObservation("p1", state, fog, 1, []));
	for (let attempt = 0; attempt < 3; attempt += 1) {
		assert.equal(
			JSON.stringify(buildObservation("p1", state, fog, 1, [])),
			first,
			`observation ${attempt + 2} differed from the first for identical inputs`,
		);
	}
});
