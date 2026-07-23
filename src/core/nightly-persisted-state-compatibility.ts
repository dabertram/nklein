import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { parseValidatedJsonlWithDiagnostics } from "../state/jsonl-store";
import { workspaceIndexFileSchema } from "../state/workspace-state-schema";
import { readFitnessTable, readMergedFitnessRows } from "../telemetry/fitness-table-store";
import {
	readAllCombinedModelBehaviorProfiles,
	readAllModelBehaviorProfiles,
} from "../telemetry/model-behavior-profile-store";
import { agentLedgerEventSchema, selectAttempts } from "./agent-attempt-ledger";
import { buildFitnessTableFromLedger } from "./agent-ledger-projections";
import { projectFitnessRowsToStableModelKeys, rankFitnessCandidatesForCell } from "./fitness-projections";
import { fitnessCellKey, fitnessDifficultyTierSchema } from "./fitness-table-schema";

const COMPATIBILITY_FIXTURE_ROOT = resolve("test/fixtures/nightly-compatibility");

const compatibilityFixtureMetadataSchema = z.object({
	schemaVersion: z.literal(1),
	releaseVersion: z.string().min(1),
	legacyCutoffMs: z.number().int().nonnegative(),
	ledgerFile: z.string().regex(/^[a-zA-Z0-9._-]+\.jsonl$/u),
	expectedLegacyLedgerEvents: z.number().int().positive(),
	expectedCorruptLedgerRecords: z.number().int().positive(),
	fitnessProbe: z.object({
		modelKey: z.string().min(1),
		role: z.string().min(1),
		difficultyTier: fitnessDifficultyTierSchema,
		expectedStoredSamples: z.number().int().positive(),
		expectedMergedSamples: z.number().int().positive(),
		expectedTopModelKey: z.string().min(1),
	}),
	behaviorProbe: z.object({
		modelId: z.string().min(1),
		expectedPersistedSamples: z.number().int().positive(),
		expectedCombinedSamples: z.number().int().positive(),
	}),
});

type CompatibilityFixtureMetadata = z.infer<typeof compatibilityFixtureMetadataSchema>;

export interface NightlyPersistedStateFixtureRef {
	readonly releaseVersion: string;
	readonly fixtureRoot: string;
	readonly fixtureSha256: string;
}

export interface NightlyPersistedStateEvidence {
	readonly schemaVersion: 1;
	readonly releaseVersion: string;
	readonly fixtureSha256: string;
	readonly workspaceMigration: {
		readonly fromVersion: 1;
		readonly toVersion: 2;
		readonly state: "completed";
		readonly backupRetained: true;
	};
	readonly ledger: {
		readonly legacyEvents: number;
		readonly currentEvents: number;
		readonly currentAttempts: number;
		readonly corruptRecordsSkipped: number;
	};
	readonly fitness: {
		readonly modelKey: string;
		readonly storedSamples: number;
		readonly mergedSamples: number;
		readonly topModelKey: string;
		readonly currentCells: number;
	};
	readonly behavior: {
		readonly modelId: string;
		readonly persistedSamples: number;
		readonly combinedSamples: number;
		readonly currentModels: number;
	};
}

interface FixtureFile {
	readonly absolutePath: string;
	readonly relativePath: string;
	readonly bytes: Buffer;
}

async function fixtureFiles(root: string): Promise<FixtureFile[]> {
	const files: FixtureFile[] = [];
	const visit = async (directory: string): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			const absolutePath = join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Compatibility fixture may not contain symlinks: ${absolutePath}`);
			if (entry.isDirectory()) {
				await visit(absolutePath);
				continue;
			}
			if (!entry.isFile()) throw new Error(`Compatibility fixture contains a non-file entry: ${absolutePath}`);
			files.push({
				absolutePath,
				relativePath: relative(root, absolutePath).split(sep).join("/"),
				bytes: await readFile(absolutePath),
			});
		}
	};
	await visit(root);
	return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function resolveFixtureRoot(path: string): Promise<string> {
	const allowedRoot = await realpath(COMPATIBILITY_FIXTURE_ROOT);
	const fixtureRoot = await realpath(resolve(path));
	if (!fixtureRoot.startsWith(`${allowedRoot}${sep}`)) {
		throw new Error(`Compatibility fixture must live below ${COMPATIBILITY_FIXTURE_ROOT}: ${path}`);
	}
	return fixtureRoot;
}

export async function hashNightlyPersistedStateFixture(path: string): Promise<string> {
	const root = await resolveFixtureRoot(path);
	const hash = createHash("sha256");
	for (const file of await fixtureFiles(root)) {
		hash.update(file.relativePath);
		hash.update("\0");
		hash.update(file.bytes);
		hash.update("\0");
	}
	return hash.digest("hex");
}

async function readFixtureMetadata(root: string): Promise<CompatibilityFixtureMetadata> {
	return compatibilityFixtureMetadataSchema.parse(
		JSON.parse(await readFile(join(root, "compatibility.json"), "utf8")),
	);
}

export async function materializeNightlyPersistedStateFixture(input: {
	readonly fixture: NightlyPersistedStateFixtureRef;
	readonly targetHome: string;
}): Promise<string> {
	const root = await resolveFixtureRoot(input.fixture.fixtureRoot);
	const files = await fixtureFiles(root);
	const actualHash = await hashNightlyPersistedStateFixture(root);
	if (actualHash !== input.fixture.fixtureSha256) {
		throw new Error(
			`Persisted-state fixture ${input.fixture.releaseVersion} hash drifted: expected ${input.fixture.fixtureSha256}, got ${actualHash}`,
		);
	}
	const metadata = await readFixtureMetadata(root);
	if (metadata.releaseVersion !== input.fixture.releaseVersion) {
		throw new Error(
			`Persisted-state fixture release mismatch: manifest=${input.fixture.releaseVersion}, fixture=${metadata.releaseVersion}`,
		);
	}
	if ((await readdir(input.targetHome)).length !== 0) {
		throw new Error(`Persisted-state fixture target HOME is not empty: ${input.targetHome}`);
	}
	for (const file of files) {
		const target = join(input.targetHome, file.relativePath);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(file.absolutePath, target);
	}
	return actualHash;
}

function parseJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function collectNightlyPersistedStateEvidence(input: {
	readonly fixture: NightlyPersistedStateFixtureRef;
	readonly home: string;
}): Promise<NightlyPersistedStateEvidence> {
	const metadata = compatibilityFixtureMetadataSchema.parse(
		parseJson(await readFile(join(input.home, "compatibility.json"), "utf8"), "compatibility metadata"),
	);
	if (metadata.releaseVersion !== input.fixture.releaseVersion) {
		throw new Error("Materialized compatibility metadata no longer matches the registered release.");
	}

	const runtimeHome = join(input.home, ".nklein", "nklein");
	const index = workspaceIndexFileSchema.parse(
		parseJson(await readFile(join(runtimeHome, "workspaces", "index.json"), "utf8"), "migrated workspace index"),
	);
	const journalRaw = parseJson(
		await readFile(join(input.home, ".nklein", "migrations", "project-migration.json"), "utf8"),
		"migration journal",
	);
	if (!isRecord(journalRaw) || journalRaw.state !== "completed") {
		throw new Error("Compatibility boot did not durably complete its workspace-index migration journal.");
	}
	const backupRecord = journalRaw.backupRecord;
	if (!isRecord(backupRecord) || typeof backupRecord.backupPath !== "string") {
		throw new Error("Compatibility migration journal does not retain a usable backup record.");
	}
	const backupRoot = resolve(input.home, ".nklein", "migrations", "backups");
	const backupPath = resolve(backupRecord.backupPath);
	if (!backupPath.startsWith(`${backupRoot}${sep}`)) {
		throw new Error("Compatibility migration backup escaped the isolated recovery root.");
	}
	const backupIndex = parseJson(
		await readFile(join(backupPath, "workspaces", "index.json"), "utf8"),
		"pre-migration backup index",
	);
	if (!isRecord(backupIndex) || backupIndex.version !== 1 || index.version !== 2) {
		throw new Error("Compatibility migration did not retain v1 and accept v2 workspace-index evidence.");
	}

	const ledgerRoot = join(input.home, "ledger");
	const ledgerText = await readFile(join(ledgerRoot, metadata.ledgerFile), "utf8");
	const fixtureLedger = parseValidatedJsonlWithDiagnostics(ledgerText, agentLedgerEventSchema);
	if (fixtureLedger.diagnostics.length !== metadata.expectedCorruptLedgerRecords) {
		throw new Error(
			`Compatibility ledger exercised ${fixtureLedger.diagnostics.length} corrupt records; expected ${metadata.expectedCorruptLedgerRecords}.`,
		);
	}
	const ledgerEvents = await readAllAgentLedger({ rootDir: ledgerRoot });
	const legacyEvents = ledgerEvents.filter((event) => event.recordedAt <= metadata.legacyCutoffMs);
	const currentEvents = ledgerEvents.filter((event) => event.recordedAt > metadata.legacyCutoffMs);
	const currentAttempts = selectAttempts(currentEvents);
	if (
		legacyEvents.length !== metadata.expectedLegacyLedgerEvents ||
		currentEvents.length === 0 ||
		currentAttempts.length === 0
	) {
		throw new Error(
			`Compatibility ledger fold expected ${metadata.expectedLegacyLedgerEvents} legacy events plus >=1 current event and attempt; got ${legacyEvents.length}, ${currentEvents.length}, and ${currentAttempts.length}.`,
		);
	}

	const fitnessPath = join(runtimeHome, "fitness-table.json");
	const storedFitness = await readFitnessTable({ path: fitnessPath });
	const identity = (modelId: string): string => modelId;
	const mergedFitness = await readMergedFitnessRows({
		path: fitnessPath,
		ledgerRootDir: ledgerRoot,
		resolveStableModelId: identity,
	});
	const currentFitness = projectFitnessRowsToStableModelKeys(buildFitnessTableFromLedger(currentEvents), identity);
	if (
		Object.keys(currentFitness).length === 0 ||
		Object.entries(currentFitness).some(([key, row]) => (mergedFitness[key]?.sampleCount ?? 0) < row.sampleCount)
	) {
		throw new Error("Current-generation attempts did not reach the production merged fitness projection.");
	}
	const fitnessKey = fitnessCellKey(metadata.fitnessProbe);
	const storedRow = storedFitness.rows[fitnessKey];
	const mergedRow = mergedFitness[fitnessKey];
	const ranked = rankFitnessCandidatesForCell(Object.values(mergedFitness), metadata.fitnessProbe);
	if (
		storedRow?.sampleCount !== metadata.fitnessProbe.expectedStoredSamples ||
		mergedRow?.sampleCount !== metadata.fitnessProbe.expectedMergedSamples ||
		ranked[0]?.modelKey !== metadata.fitnessProbe.expectedTopModelKey ||
		(mergedRow && mergedRow.successCount > mergedRow.sampleCount)
	) {
		throw new Error("Compatibility fitness evidence did not migrate, merge, and rank to the registered sane result.");
	}

	const behaviorRoot = join(runtimeHome, "model-behavior");
	const persistedBehavior = await readAllModelBehaviorProfiles({ rootDir: behaviorRoot });
	const combinedBehavior = await readAllCombinedModelBehaviorProfiles({
		rootDir: behaviorRoot,
		ledgerRootDir: ledgerRoot,
		resolveStableModelId: identity,
	});
	const currentBehaviorSamples = new Map<string, number>();
	for (const attempt of currentAttempts) {
		if (attempt.flow !== null || attempt.difficulty === null) continue;
		currentBehaviorSamples.set(attempt.modelId, (currentBehaviorSamples.get(attempt.modelId) ?? 0) + 1);
	}
	if (
		currentBehaviorSamples.size === 0 ||
		[...currentBehaviorSamples].some(([modelId, samples]) => (combinedBehavior[modelId]?.samples ?? 0) < samples)
	) {
		throw new Error("Current-generation attempts did not reach the production combined behavior projection.");
	}
	const persistedProfile = persistedBehavior[metadata.behaviorProbe.modelId];
	const combinedProfile = combinedBehavior[metadata.behaviorProbe.modelId];
	if (
		persistedProfile?.samples !== metadata.behaviorProbe.expectedPersistedSamples ||
		combinedProfile?.samples !== metadata.behaviorProbe.expectedCombinedSamples ||
		(combinedProfile &&
			(combinedProfile.successes > combinedProfile.samples ||
				combinedProfile.successRate < 0 ||
				combinedProfile.successRate > 1))
	) {
		throw new Error("Compatibility behavior evidence did not fold persisted and ledger generations sanely.");
	}

	return {
		schemaVersion: 1,
		releaseVersion: input.fixture.releaseVersion,
		fixtureSha256: input.fixture.fixtureSha256,
		workspaceMigration: { fromVersion: 1, toVersion: 2, state: "completed", backupRetained: true },
		ledger: {
			legacyEvents: legacyEvents.length,
			currentEvents: currentEvents.length,
			currentAttempts: currentAttempts.length,
			corruptRecordsSkipped: fixtureLedger.diagnostics.length,
		},
		fitness: {
			modelKey: metadata.fitnessProbe.modelKey,
			storedSamples: storedRow.sampleCount,
			mergedSamples: mergedRow.sampleCount,
			topModelKey: ranked[0].modelKey,
			currentCells: Object.keys(currentFitness).length,
		},
		behavior: {
			modelId: metadata.behaviorProbe.modelId,
			persistedSamples: persistedProfile.samples,
			combinedSamples: combinedProfile.samples,
			currentModels: currentBehaviorSamples.size,
		},
	};
}
