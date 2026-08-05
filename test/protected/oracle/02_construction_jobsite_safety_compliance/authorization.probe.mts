/**
 * P23.5 held-out oracle probe — S06 temporal-spatial authorization (project 02).
 *
 * FAIL_TO_PASS: red on an unbuilt/wrong workspace, green only when the spec's authorization predicate exists
 * and catches the adversarial cases the spec names (expired, wrong zone, stale atmospheric retest, bad O₂,
 * missing attendant, unverified LOTO). Self-contained adversarial data — the probe binds only to the
 * PRESCRIBED module path + exports (`src/domain/authorization.ts`), never to the agent's own tests/fixtures.
 *
 * Runs via the HOST's tsx (`node_modules/.bin/tsx --test`), never through anything the agent authored.
 * The workspace under grade arrives via NKLEIN_ORACLE_WORKSPACE.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const authorization = await import(pathToFileURL(join(workspace, "src/domain/authorization.ts")).href);

const HOUR = 3_600_000;
const EPOCH = 1_700_000_000_000;

function freshPermit(overrides: Record<string, unknown> = {}) {
	return {
		id: "permit-probe-cs",
		type: "confined-space",
		siteId: "site-a",
		zoneIds: ["zone-1"],
		crewId: "crew-1",
		authorizedRosterIds: ["w-ent"],
		issuedAt: EPOCH,
		expiresAt: EPOCH + 8 * HOUR,
		workWindowStart: EPOCH,
		workWindowEnd: EPOCH + 8 * HOUR,
		controlState: {
			lotoPointsVerified: { "iso-pt-1": true },
			atmosphericReadings: [
				{
					o2Percent: 20.9,
					lelPercent: 0,
					coAsPpm: 0,
					h2sAsPpm: 0,
					testedBy: "w-comp",
					testedAt: EPOCH + HOUR - 10 * 60_000,
					testerInitials: "DC",
				},
			],
			attendantId: "w-attd",
			entrySupId: "w-sup",
			authorizedEntrantIds: ["w-ent"],
			periodicRetestIntervalMs: 30 * 60_000,
		},
		prerequisitePermitIds: [],
		checklistVersionId: "chk-v1",
		...overrides,
	};
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		atTime: EPOCH + HOUR,
		inZoneId: "zone-1",
		byWorkerId: "w-ent",
		byCrewId: "crew-1",
		otherLivePermits: [],
		clock: { now: () => EPOCH + HOUR },
		prereqPermits: [],
		...overrides,
	};
}

test("oracle: a well-formed permit authorizes (the probe's own baseline)", () => {
	const result = authorization.authorizeConfinedSpaceEntry(freshPermit(), context());
	assert.equal(result.status, "Valid");
});

test("oracle: expiry is temporal, not a stored flag — atTime past expiresAt is Invalid citing expiry", () => {
	const result = authorization.authorizeConfinedSpaceEntry(freshPermit(), context({ atTime: EPOCH + 9 * HOUR }));
	assert.equal(result.status, "Invalid");
	assert.ok(
		result.reasons.some((reason: string) => /expired|expir/i.test(reason)),
		`reasons must cite expiry, got: ${JSON.stringify(result.reasons)}`,
	);
});

test("oracle: a valid permit is still invalid in the WRONG ZONE (spatial axis is independent)", () => {
	const result = authorization.authorizeConfinedSpaceEntry(freshPermit(), context({ inZoneId: "zone-2" }));
	assert.equal(result.status, "Invalid");
	assert.ok(result.reasons.some((reason: string) => /zone/i.test(reason)));
});

test("oracle: atmospheric retest STALENESS blocks entry (31min old against a 30min interval)", () => {
	const atTime = EPOCH + 2 * HOUR;
	const permit = freshPermit();
	(permit.controlState as { atmosphericReadings: { testedAt: number }[] }).atmosphericReadings[0].testedAt =
		atTime - 31 * 60_000;
	const result = authorization.authorizeConfinedSpaceEntry(permit, context({ atTime }));
	assert.equal(result.status, "Invalid");
	assert.ok(result.reasons.some((reason: string) => /retest|overdue|stale/i.test(reason)));
});

test("oracle: an in-threshold-looking permit with O2 at 18.0 is Invalid citing the reading", () => {
	const permit = freshPermit();
	(permit.controlState as { atmosphericReadings: { o2Percent: number }[] }).atmosphericReadings[0].o2Percent = 18.0;
	const result = authorization.authorizeConfinedSpaceEntry(permit, context());
	assert.equal(result.status, "Invalid");
	assert.ok(result.reasons.some((reason: string) => /o2|oxygen/i.test(reason)));
});

test("oracle: no attendant assigned blocks entry (roster/role axis)", () => {
	const permit = freshPermit();
	(permit.controlState as { attendantId: string | null }).attendantId = null;
	const result = authorization.authorizeConfinedSpaceEntry(permit, context());
	assert.equal(result.status, "Invalid");
	assert.ok(result.reasons.some((reason: string) => /attendant/i.test(reason)));
});

test("oracle: an UNVERIFIED LOTO isolation point on a prerequisite permit blocks entry", () => {
	const prereq = freshPermit({
		id: "permit-loto",
		type: "energized-work",
	});
	(prereq.controlState as { lotoPointsVerified: Record<string, boolean> }).lotoPointsVerified = {
		"iso-pt-1": true,
		"iso-pt-2": false,
	};
	const permit = freshPermit({ prerequisitePermitIds: ["permit-loto"] });
	const result = authorization.authorizeConfinedSpaceEntry(permit, context({ prereqPermits: [prereq] }));
	assert.equal(result.status, "Invalid");
	assert.ok(result.reasons.some((reason: string) => /loto/i.test(reason)));
});
