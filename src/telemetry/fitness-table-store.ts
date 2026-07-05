/**
 * §5.AB — the storage layer + schema migrations for the global fitness store (the schema is in
 * [fitness-table-schema.ts](../core/fitness-table-schema.ts)). One keyed JSON blob at `<runtimeHome>/fitness-table.json`
 * (`{ version, rows: { <cellKey>: FitnessRow } }`), keyed by `fitnessCellKey(model × role × difficulty)`. Unlike the
 * event-sourced [model-behavior-profile-store] (whose core FOLDS outcomes), a FitnessRow is an already-aggregated cell,
 * so a keyed upsert store is the natural shape; the (separate) write-side leaf batches outcomes into rows before
 * writing. Writes are ATOMIC (temp file + rename) so a crash never leaves a half-written table. Reads are defensive:
 * a missing/corrupt file ⇒ an empty table; each row is re-validated through the CURRENT schema, which fills defaults
 * for fields added since the stored version — that re-parse IS the forward migration (future breaking versions add an
 * explicit pre-step keyed off the stored `version`).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type FitnessSelectionQuery, rankFitnessCandidatesForCell } from "../core/fitness-projections";
import {
	emptyFitnessRow,
	type FitnessKey,
	type FitnessOutcome,
	type FitnessRow,
	fitnessCellKey,
	fitnessRowSchema,
	recordFitnessOutcome,
} from "../core/fitness-table-schema";

const DEFAULT_FITNESS_TABLE_PATH = join(resolveNkleinRuntimeHomePath(homedir()), "fitness-table.json");

/** Current on-disk schema version. Bump + add a migration step when a row shape changes incompatibly. */
export const FITNESS_TABLE_SCHEMA_VERSION = 1;

/** Loose envelope — the version + an unchecked row map; each row is validated individually on read (drop-on-invalid). */
const fitnessTableFileSchema = z.object({
	version: z.number().int().default(0),
	rows: z.record(z.string(), z.unknown()).default({}),
});

export interface FitnessTable {
	version: number;
	rows: Record<string, FitnessRow>;
}

export interface FitnessTableStoreOptions {
	/** Override the store path (tests). Defaults to `<runtimeHome>/fitness-table.json`. */
	path?: string;
}

function emptyTable(): FitnessTable {
	return { version: FITNESS_TABLE_SCHEMA_VERSION, rows: {} };
}

/**
 * Migrate a parsed envelope to the current schema: re-validate each row through {@link fitnessRowSchema} (fills
 * defaults for newly-added fields, drops rows that can't coerce). `storedVersion` is threaded so a future breaking bump
 * can branch here BEFORE the generic re-parse; today every version ≤ current migrates purely by the default-filling
 * re-parse.
 */
function migrateRows(rawRows: Record<string, unknown>, _storedVersion: number): Record<string, FitnessRow> {
	const rows: Record<string, FitnessRow> = {};
	for (const [key, value] of Object.entries(rawRows)) {
		const parsed = fitnessRowSchema.safeParse(value);
		if (parsed.success) {
			rows[key] = parsed.data;
		}
	}
	return rows;
}

/** Read the fitness table (empty on missing/corrupt file; rows migrated to the current schema). */
export async function readFitnessTable(options: FitnessTableStoreOptions = {}): Promise<FitnessTable> {
	const path = options.path ?? DEFAULT_FITNESS_TABLE_PATH;
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(path, "utf8"));
	} catch {
		return emptyTable();
	}
	const envelope = fitnessTableFileSchema.safeParse(raw);
	if (!envelope.success) {
		return emptyTable();
	}
	return { version: FITNESS_TABLE_SCHEMA_VERSION, rows: migrateRows(envelope.data.rows, envelope.data.version) };
}

/** Read a single fitness cell, or null when it has no recorded evidence. */
export async function readFitnessRow(
	key: Parameters<typeof fitnessCellKey>[0],
	options: FitnessTableStoreOptions = {},
): Promise<FitnessRow | null> {
	const table = await readFitnessTable(options);
	return table.rows[fitnessCellKey(key)] ?? null;
}

/** Atomically write the whole table (temp file + rename — never leaves a half-written file). */
export async function writeFitnessTable(table: FitnessTable, options: FitnessTableStoreOptions = {}): Promise<void> {
	const path = options.path ?? DEFAULT_FITNESS_TABLE_PATH;
	await mkdir(dirname(path), { recursive: true });
	const payload = JSON.stringify({ version: FITNESS_TABLE_SCHEMA_VERSION, rows: table.rows }, null, 2);
	const tmp = `${path}.tmp-${process.pid}`;
	await writeFile(tmp, payload, "utf8");
	await rename(tmp, path);
}

/**
 * §5.AB read side: rank the persisted models for a (role × difficulty) cell, best-first — the store-backed view the
 * swarm scheduler / model selector consumes. Reads the table then applies the pure {@link rankFitnessCandidatesForCell}.
 */
export async function readRankedFitnessCandidates(
	query: FitnessSelectionQuery,
	options: FitnessTableStoreOptions = {},
): Promise<FitnessRow[]> {
	const table = await readFitnessTable(options);
	return rankFitnessCandidatesForCell(Object.values(table.rows), query);
}

/** Upsert rows by their cell key (read → merge → atomic write); returns the resulting table. */
export async function upsertFitnessRows(
	rows: readonly FitnessRow[],
	options: FitnessTableStoreOptions = {},
): Promise<FitnessTable> {
	const table = await readFitnessTable(options);
	for (const row of rows) {
		table.rows[fitnessCellKey(row)] = row;
	}
	await writeFitnessTable(table, options);
	return table;
}

// Serialize read→fold→upsert PER store path: the keyed blob isn't atomic across a read-modify-write, so concurrent task
// completions (many finish at once) would lose updates. A promise chain per path funnels the writes; each waits for the
// prior. In-process only (single runtime writes this store) — good enough for the live write side.
const fitnessWriteChains = new Map<string, Promise<unknown>>();

/**
 * §5.AB LIVE write side: record one task's outcome for a (model × role × difficulty) cell. Reads the cell, folds the
 * outcome via the pure {@link recordFitnessOutcome}, and upserts — serialized per store path so concurrent completions
 * can't race. Best-effort: swallows its own errors (this rides a completion hot path and must never throw into it).
 */
export async function recordTaskFitnessOutcome(
	key: FitnessKey,
	outcome: FitnessOutcome,
	options: FitnessTableStoreOptions & { now?: number } = {},
): Promise<void> {
	const path = options.path ?? DEFAULT_FITNESS_TABLE_PATH;
	const prior = fitnessWriteChains.get(path) ?? Promise.resolve();
	const next = prior
		.catch(() => {}) // a prior failure must not stall the chain
		.then(async () => {
			const existing = await readFitnessRow(key, options);
			const folded = recordFitnessOutcome(existing ?? emptyFitnessRow(key), outcome, options.now ?? null);
			await upsertFitnessRows([folded], options);
		})
		.catch(() => {}); // best-effort telemetry — never throw into the caller
	fitnessWriteChains.set(path, next);
	await next;
}
