import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveLegacyKanbanRuntimeHomePath, resolveNkleinRuntimeHomePath } from "./runtime-paths";

const MIGRATION_MARKER_FILENAME = "migrated-from-kanban";
const MIGRATABLE_ENTRY_NAMES = ["plans", "config.json", "code-index-v1.json", "telemetry", "dev-runs"] as const;

type LegacyMigrationSkipReason = "already_migrated" | "no_legacy_root" | "current_root_exists";

interface LegacyMigrationFailure {
	entry: string;
	error: string;
}

export interface LegacyNameMigrationResult {
	attempted: boolean;
	legacyRootPath: string;
	currentRootPath: string;
	markerPath: string;
	migratedEntries: string[];
	skippedEntries: string[];
	failures: LegacyMigrationFailure[];
	skipReason: LegacyMigrationSkipReason | null;
}

export interface LegacyNameMigrationOptions {
	homePath?: string;
	now?: () => number;
	log?: (message: string) => void;
}

function createResult(input: {
	attempted: boolean;
	legacyRootPath: string;
	currentRootPath: string;
	markerPath: string;
	migratedEntries?: string[];
	skippedEntries?: string[];
	failures?: LegacyMigrationFailure[];
	skipReason?: LegacyMigrationSkipReason | null;
}): LegacyNameMigrationResult {
	return {
		attempted: input.attempted,
		legacyRootPath: input.legacyRootPath,
		currentRootPath: input.currentRootPath,
		markerPath: input.markerPath,
		migratedEntries: input.migratedEntries ?? [],
		skippedEntries: input.skippedEntries ?? [],
		failures: input.failures ?? [],
		skipReason: input.skipReason ?? null,
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function movePath(sourcePath: string, targetPath: string): Promise<void> {
	try {
		await rename(sourcePath, targetPath);
		return;
	} catch (error) {
		const errno = error as NodeJS.ErrnoException;
		if (errno?.code !== "EXDEV") {
			throw error;
		}
	}

	const sourceStat = await stat(sourcePath);
	if (sourceStat.isDirectory()) {
		await cp(sourcePath, targetPath, {
			recursive: true,
			errorOnExist: true,
			force: false,
		});
		await rm(sourcePath, { recursive: true, force: true });
		return;
	}

	await cp(sourcePath, targetPath, {
		recursive: false,
		errorOnExist: true,
		force: false,
	});
	await rm(sourcePath, { force: true });
}

async function writeMigrationMarker(
	markerPath: string,
	result: LegacyNameMigrationResult,
	now: () => number,
): Promise<void> {
	await mkdir(dirname(markerPath), { recursive: true });
	await writeFile(
		markerPath,
		`${JSON.stringify(
			{
				completedAt: new Date(now()).toISOString(),
				migratedEntries: result.migratedEntries,
				skippedEntries: result.skippedEntries,
				failures: result.failures,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

function formatMigrationLog(result: LegacyNameMigrationResult): string {
	return JSON.stringify({
		legacyRootPath: result.legacyRootPath,
		currentRootPath: result.currentRootPath,
		migratedEntries: result.migratedEntries,
		skippedEntries: result.skippedEntries,
		failures: result.failures,
		skipReason: result.skipReason,
	});
}

export async function runLegacyNameMigration(
	options: LegacyNameMigrationOptions = {},
): Promise<LegacyNameMigrationResult> {
	const now = options.now ?? Date.now;
	const log = options.log ?? ((message: string) => process.emitWarning(message));
	const homePath = options.homePath ?? homedir();
	const currentRootPath = resolveNkleinRuntimeHomePath(homePath);
	const legacyRootPath = resolveLegacyKanbanRuntimeHomePath(homePath);
	const markerPath = join(currentRootPath, MIGRATION_MARKER_FILENAME);

	if (await pathExists(markerPath)) {
		return createResult({
			attempted: false,
			legacyRootPath,
			currentRootPath,
			markerPath,
			skipReason: "already_migrated",
		});
	}
	if (!(await pathExists(legacyRootPath))) {
		return createResult({
			attempted: false,
			legacyRootPath,
			currentRootPath,
			markerPath,
			skipReason: "no_legacy_root",
		});
	}
	if (await pathExists(currentRootPath)) {
		return createResult({
			attempted: false,
			legacyRootPath,
			currentRootPath,
			markerPath,
			skipReason: "current_root_exists",
		});
	}

	await mkdir(currentRootPath, { recursive: true });
	const migratedEntries: string[] = [];
	const skippedEntries: string[] = [];
	const failures: LegacyMigrationFailure[] = [];

	for (const entryName of MIGRATABLE_ENTRY_NAMES) {
		const sourcePath = join(legacyRootPath, entryName);
		if (!(await pathExists(sourcePath))) {
			skippedEntries.push(entryName);
			continue;
		}

		const targetPath = join(currentRootPath, entryName);
		try {
			await movePath(sourcePath, targetPath);
			migratedEntries.push(entryName);
		} catch (error) {
			failures.push({
				entry: entryName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const result = createResult({
		attempted: true,
		legacyRootPath,
		currentRootPath,
		markerPath,
		migratedEntries,
		skippedEntries,
		failures,
	});
	await writeMigrationMarker(markerPath, result, now);

	const severity = failures.length > 0 ? "warning" : "info";
	log(`[nklein] Legacy Kanban runtime migration ${severity}: ${formatMigrationLog(result)}`);

	return result;
}

export async function readLegacyNameMigrationMarker(markerPath: string): Promise<string | null> {
	try {
		return await readFile(markerPath, "utf8");
	} catch {
		return null;
	}
}
