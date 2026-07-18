/**
 * F12.109 bulk fan-out seeding — one card template × N inputs ("scale your compute to scale your impact").
 *
 * The board could only grow cards one at a time (or via a model-planned decompose); the ADW batch mode is the
 * SAME template stamped over a list — file paths, issue lines, CSV rows — creating N independent backlog cards
 * that flow through the normal admission gates (concurrency, endpoint, sandbox). The parsing/substitution halves
 * are pure and tested; the seeding half loops the existing `createTask` path so every card is a first-class
 * board card, not a special batch object.
 */

import { readFile } from "node:fs/promises";

/** Substitution tokens: `{input}` = the raw input line, `{i}` = 1-based index, `{slug}` = slugified input. */
export function renderBulkTemplate(template: string, input: string, index: number): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return template
		.replaceAll("{input}", input)
		.replaceAll("{i}", String(index + 1))
		.replaceAll("{slug}", slug || `input-${index + 1}`);
}

export const BULK_SEED_MAX_INPUTS = 100;

/** Parse an inline list (comma or newline separated) or file content (one per line, `#` comments) into inputs. */
export function parseBulkInputs(raw: string): string[] {
	const inputs = raw
		.split(/\r?\n|,/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
	if (inputs.length > BULK_SEED_MAX_INPUTS) {
		throw new Error(
			`Bulk seed capped at ${BULK_SEED_MAX_INPUTS} inputs (${inputs.length} given) — split the list; an unbounded fan-out is a board flood, not a batch.`,
		);
	}
	return [...new Set(inputs)];
}

export interface BulkSeedPlanEntry {
	readonly input: string;
	readonly title: string;
	readonly prompt: string;
}

/** Expand the template over the inputs — the pure half of seed-bulk; the CLI loops createTask over it. */
export function planBulkSeed(options: {
	promptTemplate: string;
	titleTemplate?: string;
	inputs: readonly string[];
}): BulkSeedPlanEntry[] {
	return options.inputs.map((input, index) => ({
		input,
		title: renderBulkTemplate(options.titleTemplate ?? "{input}", input, index),
		prompt: renderBulkTemplate(options.promptTemplate, input, index),
	}));
}

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
