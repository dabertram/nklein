/**
 * F12.109 bulk fan-out seeding — the PURE substitution/parsing halves, shared by the `task seed-bulk` CLI and
 * the board's multi-task template mode ("scale your compute to scale your impact": one template stamped over a
 * list of inputs, every card riding the normal admission gates).
 */

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

/** Expand the template over the inputs — the pure half of seed-bulk; callers loop card creation over it. */
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
