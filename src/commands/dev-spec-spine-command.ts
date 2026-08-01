import { readFileSync } from "node:fs";
import { buildSpecRequirementSpine, requirementClosure } from "../core/spec-requirement-spine";

/**
 * `nklein dev spec-spine <file>` — the requirement spine P23.7 asks for, and the retrieval unit that makes the
 * spec's own instruction ("read the entire specification before planning") unnecessary.
 *
 * `--card <id>` prints exactly what an agent needs to work that card: the card and its transitive dependencies,
 * dependencies first. Everything else in the document stays unread.
 *
 * Read-only, like `spec-index`: the specification is a TEST FIXTURE whose size is part of what it measures.
 */
export function runDevSpecSpineCommand(file: string, options: { card?: string; json?: boolean } = {}): void {
	const spine = buildSpecRequirementSpine(readFileSync(file, "utf8"));

	if (options.card) {
		const closure = requirementClosure(spine, options.card);
		if (closure.length === 0) {
			process.stdout.write(`No card ${options.card} in this document.\n`);
			return;
		}
		const byId = new Map(spine.cards.map((card) => [card.id, card]));
		if (options.json) {
			const cards = closure.map((id) => byId.get(id));
			process.stdout.write(`${JSON.stringify(cards, null, 2)}\n`);
			return;
		}
		process.stdout.write(`${options.card} needs ${closure.length} card(s), dependencies first:\n\n`);
		for (const id of closure) {
			const card = byId.get(id);
			process.stdout.write(`  ${id}  ${card?.title ?? ""}\n`);
			process.stdout.write(`        invariant: ${card?.invariant ?? "(none named)"}\n`);
			process.stdout.write(`        acceptance: ${card?.acceptance ?? "(none named)"}\n`);
		}
		return;
	}

	if (options.json) {
		process.stdout.write(`${JSON.stringify(spine, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${spine.summary}\n`);
	if (spine.topologicalOrder.length > 0) {
		process.stdout.write(`Build order: ${spine.topologicalOrder.join(" → ")}\n`);
	}
	if (spine.issues.length > 0) {
		// Printed prominently: these are gaps in the SPECIFICATION, which is the point of having a spine.
		process.stdout.write("\nISSUES (gaps in the document, not in this tool):\n");
		for (const issue of spine.issues) {
			process.stdout.write(`  ${issue.kind}: ${issue.detail}\n`);
		}
	}
	process.stdout.write("\nRetrieve one card's closure with --card <id> instead of reading the whole specification.\n");
}
