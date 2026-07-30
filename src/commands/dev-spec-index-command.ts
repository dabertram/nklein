import { readFileSync } from "node:fs";
import { buildSpecSectionIndex, planSpecRetrieval } from "../core/spec-section-index";

/**
 * P23.7 — `nklein dev spec-index <file> [--budget-words N]`: make an over-long specification navigable.
 *
 * The fixture spec for dev-test-project 36 is 25k words and opens by telling the agent to read all of it. Against
 * the ≥32k context floor that instruction cannot be followed and leave room for system instructions, repo
 * evidence, reasoning and a plan. This prints what an architect would actually retrieve, and what it would defer.
 *
 * Read-only by design: the specification is a TEST FIXTURE whose size is part of what it measures, so this makes
 * it navigable rather than rewriting it.
 */
export function runDevSpecIndexCommand(file: string, options: { budgetWords?: string; json?: boolean } = {}): void {
	const budgetWords = Number(options.budgetWords) > 0 ? Number(options.budgetWords) : 4_000;
	const index = buildSpecSectionIndex(readFileSync(file, "utf8"));
	const plan = planSpecRetrieval(index, budgetWords);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ index, plan }, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${index.summary}\n${plan.summary}\n\n`);
	process.stdout.write("HEAVIEST SECTIONS (own words — the ones worth splitting or deferring):\n");
	for (const section of [...index.sections].sort((left, right) => right.ownWords - left.ownWords).slice(0, 10)) {
		process.stdout.write(`  ${String(section.ownWords).padStart(5)}  ${section.id}\n`);
		process.stdout.write(`         ${section.path.join(" › ")}\n`);
	}
	process.stdout.write(
		"\nIds are stable across unrelated edits, so they can be cited in a plan or a card and still resolve later.\n",
	);
}
