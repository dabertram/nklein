import type { NKleinPlanTask } from "./nklein-plan-artifacts";

/**
 * §5.AK/§5.B — render a card's richer CONTRACT (preconditions/inputs/expected outputs, acceptance checks, non-goals,
 * consumed dependency outputs, rollback/repair hints, downstream-invalidation rules) into a compact markdown brief the
 * worker prepends to its card prompt. This is the NODE-LOCAL consumption of the enriched schema: the worker executes
 * against an EXPLICIT contract instead of re-deriving it from prose. Pure + total — an empty contract yields an empty
 * string (nothing is injected), so a card decomposed WITHOUT the new fields is byte-identical to before.
 */

/** The contract fields the brief renders, in priority order (what to do → how it's judged → boundaries → coupling). */
const CONTRACT_SECTIONS: ReadonlyArray<{ key: keyof NKleinPlanTask; heading: string }> = [
	{ key: "preconditions", heading: "Preconditions" },
	{ key: "inputs", heading: "Inputs" },
	{ key: "expectedOutputs", heading: "Expected outputs" },
	{ key: "acceptanceChecks", heading: "Acceptance checks" },
	{ key: "nonGoals", heading: "Non-goals" },
	// F1.8 work-package bounds — the card's parallel-write safety contract.
	{ key: "writeScope", heading: "Write scope (files you may modify)" },
	{ key: "forbiddenPaths", heading: "Forbidden paths (do NOT touch)" },
	{ key: "interfaces", heading: "Interfaces to honor (do not break)" },
	{ key: "dependencyOutputsConsumed", heading: "Dependency outputs consumed" },
	{ key: "rollbackOrRepairHints", heading: "Rollback / repair hints" },
	{ key: "downstreamInvalidationRules", heading: "Downstream invalidation rules" },
];

/** True when the card carries any populated contract field (so callers can skip the injection entirely). */
export function hasCardContract(task: NKleinPlanTask): boolean {
	return CONTRACT_SECTIONS.some((section) => cleanList(task[section.key]).length > 0);
}

/** Coerce a schema list to trimmed, non-empty, de-duplicated strings (defensive against messy model output). */
function cleanList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const trimmed = item.trim();
		if (trimmed.length > 0 && !seen.has(trimmed)) {
			seen.add(trimmed);
			out.push(trimmed);
		}
	}
	return out;
}

/**
 * Render the contract brief. Returns "" when no contract field is populated. Otherwise a `## Card contract` block with
 * one bulleted subsection per populated field group, in {@link CONTRACT_SECTIONS} order.
 */
export function renderCardContractBrief(task: NKleinPlanTask): string {
	const blocks: string[] = [];
	for (const section of CONTRACT_SECTIONS) {
		const items = cleanList(task[section.key]);
		if (items.length === 0) {
			continue;
		}
		blocks.push(`**${section.heading}:**\n${items.map((item) => `- ${item}`).join("\n")}`);
	}
	if (blocks.length === 0) {
		return "";
	}
	return `## Card contract\n\n${blocks.join("\n\n")}`;
}
