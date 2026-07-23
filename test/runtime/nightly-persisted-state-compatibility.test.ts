import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	collectNightlyPersistedStateEvidence,
	hashNightlyPersistedStateFixture,
	materializeNightlyPersistedStateFixture,
	type NightlyPersistedStateFixtureRef,
} from "../../src/core/nightly-persisted-state-compatibility";
import { buildTerminalAttemptEvent } from "../../src/nklein-agent/nklein-ledger-attempt";
import { appendAgentLedgerEvent } from "../../src/state/agent-attempt-ledger-store";
import {
	initSharedRuntimeIdModelKeyMap,
	resetSharedRuntimeIdModelKeyMapForTest,
} from "../../src/state/runtime-id-model-key-map-store";
import { runProjectMigrations } from "../../src/update/project-migration-runner";

const FIXTURE_ROOT = "test/fixtures/nightly-compatibility/0.0.0";
const FIXTURE_SHA256 = "ff230498a42e4f356d6a11408e72ff75b88b04e2323d431ed4c5ded935a4f2f9";
const fixture: NightlyPersistedStateFixtureRef = {
	releaseVersion: "0.0.0",
	fixtureRoot: FIXTURE_ROOT,
	fixtureSha256: FIXTURE_SHA256,
};

const tempHomes: string[] = [];

async function makeHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "nklein-compat-home-"));
	tempHomes.push(home);
	return home;
}

afterEach(async () => {
	resetSharedRuntimeIdModelKeyMapForTest();
	await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("nightly persisted-state compatibility", () => {
	it("hash-binds, migrates, and folds a prior-release HOME with current evidence", async () => {
		expect(await hashNightlyPersistedStateFixture(FIXTURE_ROOT)).toBe(FIXTURE_SHA256);
		const home = await makeHome();
		await expect(materializeNightlyPersistedStateFixture({ fixture, targetHome: home })).resolves.toBe(
			FIXTURE_SHA256,
		);

		const migration = await runProjectMigrations({
			runtimeHomePath: join(home, ".nklein", "nklein"),
			now: () => new Date("2026-07-23T07:00:00.000Z"),
		});
		expect(migration).toMatchObject({ status: "accepted", currentVersion: 2 });

		const current = buildTerminalAttemptEvent({
			taskId: "current-task",
			workspacePath: "/current/workspace",
			state: "awaiting_review",
			role: "worker",
			providerId: "lmstudio",
			modelId: "current-model",
			endpoint: "http://127.0.0.1:1234/v1",
			startedAt: 19_000,
			endedAt: 20_000,
			promptTokens: null,
			completionTokens: null,
			timeoutReason: null,
			difficulty: "medium",
		});
		await appendAgentLedgerEvent(
			{ ...current, eventId: "current-event", attemptId: "current-attempt", recordedAt: 20_000 },
			{ rootDir: join(home, "ledger") },
		);
		const contaminatingMap = join(home, "process-global-model-map.json");
		await writeFile(contaminatingMap, JSON.stringify({ "current-model": "wrong-global-model" }), "utf8");
		await initSharedRuntimeIdModelKeyMap(contaminatingMap);

		const evidence = await collectNightlyPersistedStateEvidence({ fixture, home });
		expect(evidence).toMatchObject({
			releaseVersion: "0.0.0",
			fixtureSha256: FIXTURE_SHA256,
			workspaceMigration: { fromVersion: 1, toVersion: 2, state: "completed", backupRetained: true },
			ledger: { legacyEvents: 1, currentEvents: 1, currentAttempts: 1, corruptRecordsSkipped: 2 },
			fitness: { storedSamples: 2, mergedSamples: 3, currentCells: 1 },
			behavior: { persistedSamples: 2, combinedSamples: 3, currentModels: 1 },
		});
		expect(evidence.fitness.topModelKey).toBe(evidence.fitness.modelKey);
	});

	it("refuses fixture drift and sources outside the release-fixture root", async () => {
		await expect(
			materializeNightlyPersistedStateFixture({
				fixture: { ...fixture, fixtureSha256: "0".repeat(64) },
				targetHome: await makeHome(),
			}),
		).rejects.toThrow(/hash drifted/);
		await expect(hashNightlyPersistedStateFixture(".")).rejects.toThrow(/must live below/);
	});
});
