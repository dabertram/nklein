/**
 * `nklein dev synthesis-saving` — how many tokens does the live evidence extraction save? (F4.6b, computable half)
 *
 * Measures the real `evidenceExcerpt` path over a captured evidence set, so the number describes what production
 * actually does. It reports SAVING only, and says so: a saving that dropped a needed span is a regression the
 * token count cannot see — that is the answer-quality half, which needs the eval harness (a model).
 */

import { readFile } from "node:fs/promises";
import type { RetrievalEvidence } from "../core/retrieval-loop-driver";
import { measureSynthesisEvidenceSaving } from "../core/retrieval-synthesis-adapter";

function parseEvidence(text: string): RetrievalEvidence[] {
	const out: RetrievalEvidence[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		try {
			const p = JSON.parse(line) as { id?: unknown; text?: unknown };
			if (typeof p.id === "string" && typeof p.text === "string") {
				out.push({ id: p.id, text: p.text });
			}
		} catch {
			// skipped; an empty set reports "no evidence"
		}
	}
	return out;
}

export async function runDevSynthesisSavingCommand(options: {
	evidence?: string;
	task?: string;
	json?: boolean;
}): Promise<void> {
	if (!options.evidence || !options.task) {
		process.stdout.write(
			"usage: dev synthesis-saving --evidence <file> --task <text>\n" +
				"  Each evidence line: {id, text} JSON. Measures the LIVE excerpt path's token saving.\n",
		);
		process.exitCode = 2;
		return;
	}
	const text = await readFile(options.evidence, "utf8").catch(() => null);
	if (text === null) {
		process.stdout.write(`Could not read ${options.evidence}.\n`);
		process.exitCode = 1;
		return;
	}

	const measurement = measureSynthesisEvidenceSaving(options.task, parseEvidence(text));
	if (options.json) {
		process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
		return;
	}
	process.stdout.write(`SYNTHESIS EVIDENCE SAVING\n\n${measurement.summary}\n\n`);
	for (const e of measurement.perEvidence) {
		const saved = e.before - e.after;
		process.stdout.write(`  ${e.id}: ${e.before} → ${e.after} token(s)${saved > 0 ? ` (−${saved})` : ""}\n`);
	}
}
