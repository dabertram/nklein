/**
 * P23.5 held-out oracle probes — S07 conflicting-work, S10 recordability, S11 300-log (project 02).
 *
 * FAIL_TO_PASS. Guards the spec's remaining hard seams: adjacent-zone conflict expansion (work drifts — a
 * bare zone-intersection check must fail here), the OSHA 1904 classifier's DART edge, and the 300-log
 * UPGRADE path (a first-aid→recordable follow-up must UPDATE the one entry, never append a second).
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const conflictModule = await import(pathToFileURL(join(workspace, "src/domain/conflict-check.ts")).href);
const recordabilityModule = await import(pathToFileURL(join(workspace, "src/domain/recordability.ts")).href);
const log300Module = await import(pathToFileURL(join(workspace, "src/domain/log-300.ts")).href);
const eventLogModule = await import(pathToFileURL(join(workspace, "src/domain/event-log.ts")).href);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const EPOCH = 1_700_000_000_000;

const ZONE_1 = { id: "zone-1", siteId: "site-a", name: "Utility Vault", adjacentZoneIds: ["zone-2"] };
const ZONE_2 = { id: "zone-2", siteId: "site-a", name: "Adjacent Excavation", adjacentZoneIds: ["zone-1"] };

function permit(overrides: Record<string, unknown>) {
	return {
		id: "permit-x",
		type: "hot-work",
		siteId: "site-a",
		zoneIds: ["zone-1"],
		crewId: "crew-1",
		authorizedRosterIds: [],
		issuedAt: EPOCH,
		expiresAt: EPOCH + 8 * HOUR,
		workWindowStart: EPOCH,
		workWindowEnd: EPOCH + 8 * HOUR,
		controlState: {
			lotoPointsVerified: {},
			atmosphericReadings: [],
			attendantId: null,
			entrySupId: null,
			authorizedEntrantIds: [],
			periodicRetestIntervalMs: 30 * 60_000,
		},
		prerequisitePermitIds: [],
		checklistVersionId: "chk-v1",
		...overrides,
	};
}

test("oracle: work drifts — an ADJACENT-zone permit with overlapping time conflicts (zone-intersection alone must fail this)", () => {
	const hotWork = permit({ id: "permit-hot", zoneIds: ["zone-1"] });
	const excavation = permit({ id: "permit-exc", type: "excavation", zoneIds: ["zone-2"] });
	const result = conflictModule.checkConflictingWork(hotWork, ZONE_1, [excavation], {
		"zone-1": ZONE_1,
		"zone-2": ZONE_2,
	});
	assert.equal(result.conflicting, true);
	assert.equal(result.otherPermitId, "permit-exc");
});

test("oracle: the same zones with DISJOINT time windows do not conflict (temporal axis respected)", () => {
	const hotWork = permit({ id: "permit-hot", zoneIds: ["zone-1"] });
	const later = permit({
		id: "permit-later",
		type: "excavation",
		zoneIds: ["zone-1"],
		issuedAt: EPOCH + 9 * HOUR,
		expiresAt: EPOCH + 17 * HOUR,
	});
	const result = conflictModule.checkConflictingWork(hotWork, ZONE_1, [later], {
		"zone-1": ZONE_1,
		"zone-2": ZONE_2,
	});
	assert.equal(result.conflicting, false);
});

test("oracle: 1904 classifier — days-away is DART, first-aid-only is not recordable, and criteria are cited", () => {
	const dart = recordabilityModule.classifyRecordability({
		treatmentLevel: "days-away",
		daysAwayFromWork: 2,
		restrictedDaysOrTransfer: 0,
		lossOfConsciousness: false,
		privacyCase: false,
	});
	assert.equal(dart.classification, "dart");
	assert.equal(dart.isDart, true);
	assert.ok(dart.citedCriteria.length > 0, "classification must cite its criteria — auditability, not vibes");
	const firstAid = recordabilityModule.classifyRecordability({
		treatmentLevel: "first-aid-only",
		daysAwayFromWork: 0,
		restrictedDaysOrTransfer: 0,
		lossOfConsciousness: false,
		privacyCase: false,
	});
	assert.equal(firstAid.classification, "not-recordable");
	assert.equal(firstAid.is300LogEntry, false);
});

function incidentCommand(input: {
	id: string;
	stamp: Record<string, number>;
	incidentId: string;
	type: string;
	clientCreatedAt: number;
}) {
	return {
		id: input.id,
		actor: "device-a",
		causalStamp: input.stamp,
		targetEntityId: input.incidentId,
		targetBaseVersion: 0,
		payload: {
			kind: "log-incident",
			incident: {
				siteId: "site-a",
				zoneId: "zone-1",
				occurredAt: EPOCH,
				type: input.type,
				witnessIds: [],
				equipmentIds: [],
				evidenceRefs: [],
				icamFactors: {
					absentFailedDefences: [],
					individualTeamActions: [],
					taskEnvironmentalConditions: [],
					organisationalFactors: [],
				},
				timeline: [],
			},
		},
		clientCreatedAt: input.clientCreatedAt,
	};
}

test("oracle: the 300-log UPGRADE path updates the single entry — never a duplicate case for the same incident", () => {
	const log = new eventLogModule.EventLog();
	const accepted = (commandId: string) => ({ commandId, status: "Accepted" });
	const first = incidentCommand({
		id: "c-i1",
		stamp: { "device-a": 1 },
		incidentId: "incident-1",
		type: "first-aid",
		clientCreatedAt: EPOCH + HOUR,
	});
	const upgrade = incidentCommand({
		id: "c-i2",
		stamp: { "device-a": 2 },
		incidentId: "incident-1",
		type: "recordable",
		clientCreatedAt: EPOCH + 2 * HOUR,
	});
	log.append(first, accepted("c-i1"));
	log.append(upgrade, accepted("c-i2"));
	const entries = log300Module.projectLog300(log, { now: () => EPOCH + 3 * HOUR });
	assert.equal(entries.length, 1, "an upgrade must update the existing case, not append a second entry");
});

test("oracle: recording 8 days after occurrence is flagged outside the 7-day window", () => {
	const log = new eventLogModule.EventLog();
	const late = incidentCommand({
		id: "c-late",
		stamp: { "device-a": 1 },
		incidentId: "incident-late",
		type: "recordable",
		clientCreatedAt: EPOCH + 8 * DAY,
	});
	log.append(late, { commandId: "c-late", status: "Accepted" });
	const entries = log300Module.projectLog300(log, { now: () => EPOCH + 9 * DAY });
	assert.equal(entries.length, 1);
	assert.equal(entries[0].recordedWithinWindow, false);
});
