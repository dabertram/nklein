/**
 * F12.109 bulk fan-out seeding — CLI half. The pure substitution/parsing lives in src/core/bulk-seed.ts (shared
 * with the board UI's template mode); this module keeps the filesystem input resolution and re-exports the pure
 * API for existing importers.
 */

import { readFile } from "node:fs/promises";
import { parseBulkInputs } from "../../core/bulk-seed.js";

export {
	BULK_SEED_MAX_INPUTS,
	type BulkSeedPlanEntry,
	parseBulkInputs,
	planBulkSeed,
	renderBulkTemplate,
} from "../../core/bulk-seed.js";

/** Resolve the input list from --inputs (inline) or --inputs-file (path). Exactly one must be provided. */
export async function resolveBulkInputs(options: { inputs?: string; inputsFile?: string }): Promise<string[]> {
	if (options.inputs && options.inputsFile) {
		throw new Error("Pass either --inputs or --inputs-file, not both.");
	}
	if (options.inputs) {
		return parseBulkInputs(options.inputs);
	}
	if (options.inputsFile) {
		return parseBulkInputs(await readFile(options.inputsFile, "utf8"));
	}
	throw new Error('seed-bulk needs an input list: --inputs "a,b,c" or --inputs-file <path>.');
}
