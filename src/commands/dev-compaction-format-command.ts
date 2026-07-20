/**
 * `nklein dev compaction-format` — render one fact set as all three compaction arms (P18.6), so the A/B is
 * inspectable before any model time is spent.
 *
 * The format core shipped with NO consumer — the same built-but-unwired shape this session has been draining.
 * Its A/B needs the eval harness (model time) to produce a WINNER, but the arms themselves are deterministic, so
 * a `dev` command can render and validate them now: it makes the experiment concrete rather than hypothetical and
 * gives the harness a real entry point when the runs happen.
 *
 * ── IT VALIDATES THE INVARIANT, NOT JUST PRINTS ──
 * The whole experiment is void if the arms present different facts — that would measure summarisation quality
 * while claiming to measure structure. So this checks that all three arms carry the identical fact-id SET and
 * says so, rather than trusting the renderer. A printer that only prints could hide exactly the confound P18.6
 * exists to avoid.
 */

import { readFile } from "node:fs/promises";
import type { CompactionFact } from "../core/compaction-format";
import { COMPACTION_FORMATS, renderAllArms } from "../core/compaction-format";

function parseFacts(text: string): { facts: CompactionFact[]; skipped: number } {
	const facts: CompactionFact[] = [];
	let skipped = 0;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as { id?: unknown; text?: unknown };
			if (typeof parsed.id === "string" && typeof parsed.text === "string") {
				facts.push({ id: parsed.id, text: parsed.text });
			} else {
				skipped += 1;
			}
		} catch {
			skipped += 1;
		}
	}
	return { facts, skipped };
}

export async function runDevCompactionFormatCommand(options: {
	facts?: string;
	seed?: string;
	json?: boolean;
}): Promise<void> {
	if (!options.facts) {
		process.stdout.write("usage: dev compaction-format --facts <file>   (one {id,text} JSON per line)\n");
		process.exitCode = 2;
		return;
	}
	const text = await readFile(options.facts, "utf8").catch(() => null);
	if (text === null) {
		process.stdout.write(`Could not read ${options.facts}.\n`);
		process.exitCode = 1;
		return;
	}

	const { facts, skipped } = parseFacts(text);
	const seed = Number.parseInt(options.seed ?? "1", 10) || 1;
	const arms = renderAllArms(facts, seed);

	// The experiment's load-bearing invariant: every arm presents the SAME facts, only the arrangement differs.
	// Checked here so a broken renderer surfaces as a failed invariant rather than as a silently invalid A/B.
	const idSets = COMPACTION_FORMATS.map((format) => [...arms[format].order].sort());
	const reference = idSets[0] ?? [];
	const identical = idSets.every(
		(ids) => ids.length === reference.length && ids.every((id, i) => id === reference[i]),
	);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ arms, factCount: facts.length, identical, skipped }, null, 2)}\n`);
		process.exitCode = identical ? 0 : 1;
		return;
	}

	process.stdout.write(`COMPACTION FORMAT A/B — ${facts.length} fact(s), shuffle seed ${seed}\n`);
	process.stdout.write(
		identical
			? "✓ all three arms present the identical fact set — the comparison is about STRUCTURE, not content.\n\n"
			: "⚠️ arms DIFFER in which facts they carry — the A/B would measure content, not structure. Do not run it.\n\n",
	);
	for (const format of COMPACTION_FORMATS) {
		process.stdout.write(`── ${format} ──\n${arms[format].text}\n\n`);
	}
	if (skipped > 0) {
		process.stdout.write(`${skipped} line(s) were not valid {id,text} JSON and were skipped.\n`);
	}
	process.stdout.write(
		"No arm is preferred here by design — P18.6's whole point is that nobody has measured this. The eval\n" +
			"harness picks a winner; this only makes the arms concrete and checks they are comparable.\n",
	);
	process.exitCode = identical ? 0 : 1;
}
