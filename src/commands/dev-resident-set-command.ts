/**
 * `nklein dev resident-set` — which models is it worth keeping loaded? (F12.77)
 *
 * A RECOMMENDATION, never an action. Cold loads cost 40–90s, and a fleet that reloads the same model six times
 * an evening has spent ten minutes doing nothing — but the standing production constraint (David, 2026-07-19) is
 * that !Klein NEVER auto-loads or auto-unloads. So this prints a set for the OPERATOR to act on, and the core it
 * calls has no `toLoad`/`toUnload` field to execute even if this command wanted to.
 *
 * The core shipped with no consumer; this is one that needs no live fleet — it reads observed per-model
 * candidates from a file, exactly the shape the fitness store already holds.
 */

import { readFile } from "node:fs/promises";
import { type ResidencyCandidate, recommendResidentSet } from "../core/resident-set-recommendation";

function parseCandidates(text: string): ResidencyCandidate[] {
	const candidates: ResidencyCandidate[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		try {
			const p = JSON.parse(line) as Partial<ResidencyCandidate>;
			if (
				typeof p.modelId === "string" &&
				typeof p.sizeBytes === "number" &&
				(p.measuredFitness === null || typeof p.measuredFitness === "number") &&
				typeof p.observationCount === "number" &&
				typeof p.requestCount === "number"
			) {
				candidates.push({
					modelId: p.modelId,
					sizeBytes: p.sizeBytes,
					measuredFitness: p.measuredFitness ?? null,
					observationCount: p.observationCount,
					requestCount: p.requestCount,
				});
			}
		} catch {
			// Skipped; the recommender's own guards handle an empty candidate set.
		}
	}
	return candidates;
}

export async function runDevResidentSetCommand(options: {
	candidates?: string;
	budgetGb?: string;
	json?: boolean;
}): Promise<void> {
	if (!options.candidates || !options.budgetGb) {
		process.stdout.write(
			"usage: dev resident-set --candidates <file> --budget-gb <n>\n" +
				"  Each candidate line: {modelId, sizeBytes, measuredFitness|null, observationCount, requestCount} JSON.\n" +
				"  Prints a set to keep loaded — a RECOMMENDATION only; !Klein never auto-loads.\n",
		);
		process.exitCode = 2;
		return;
	}
	const budgetGb = Number.parseFloat(options.budgetGb);
	if (!Number.isFinite(budgetGb) || budgetGb <= 0) {
		process.stdout.write(`--budget-gb must be a positive number; got "${options.budgetGb}".\n`);
		process.exitCode = 2;
		return;
	}

	const text = await readFile(options.candidates, "utf8").catch(() => null);
	if (text === null) {
		process.stdout.write(`Could not read ${options.candidates}.\n`);
		process.exitCode = 1;
		return;
	}

	const recommendation = recommendResidentSet({
		candidates: parseCandidates(text),
		budgetBytes: Math.round(budgetGb * 1024 ** 3),
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify(recommendation, null, 2)}\n`);
		return;
	}

	const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	process.stdout.write(`RESIDENT-SET RECOMMENDATION (operator acts; !Klein never auto-loads)\n\n`);
	process.stdout.write(
		`${recommendation.recommended.length} model(s) recommended · ${Math.round(recommendation.secondsSaved)}s of cold loads avoided/window · ${gb(recommendation.bytesUsed)} of ${gb(recommendation.bytesAvailable)} usable.\n\n`,
	);
	if (recommendation.recommended.length > 0) {
		process.stdout.write("Keep loaded:\n");
		for (const model of recommendation.recommended) {
			process.stdout.write(
				`  ✓ ${model.modelId} — ${Math.round(model.secondsSaved)}s/window saved (${model.reason})\n`,
			);
		}
	}
	if (recommendation.excluded.length > 0) {
		process.stdout.write("\nExcluded:\n");
		for (const model of recommendation.excluded) {
			process.stdout.write(`  · ${model.modelId} [${model.reason}] ${model.detail}\n`);
		}
	}
}
