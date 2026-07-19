import { readFile } from "node:fs/promises";
import { decideDefaultFlip, type PairedOutcome } from "../core/ab-significance-gate";

/**
 * F12.41 — `nklein dev flip-gate`: the consumable default-flip consult. Feed it the paired per-task outcomes an
 * A/B harness produced (JSONL, one `{"a": bool, "b": bool}` per line — a = baseline arm, b = candidate arm, same
 * task per line, model held fixed) and it prints the powered McNemar verdict. This replaces "eyeballed green →
 * flip" for the F1.xb-class default flips: no flip recommendation without significance AND the practical margin.
 */
export async function runDevFlipGateCommand(options: {
	pairs: string;
	alpha?: string;
	minEffect?: string;
	json?: boolean;
}): Promise<void> {
	const raw = await readFile(options.pairs, "utf8").catch((error: unknown) => {
		process.stderr.write(`Could not read pairs file ${options.pairs}: ${String(error)}\n`);
		return null;
	});
	if (raw === null) {
		process.exitCode = 1;
		return;
	}
	const pairs: PairedOutcome[] = [];
	let skipped = 0;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as { a?: unknown; b?: unknown };
			if (typeof parsed.a === "boolean" && typeof parsed.b === "boolean") {
				pairs.push({ a: parsed.a, b: parsed.b });
			} else {
				skipped += 1;
			}
		} catch {
			skipped += 1;
		}
	}
	const alpha = options.alpha !== undefined ? Number.parseFloat(options.alpha) : undefined;
	const minEffect = options.minEffect !== undefined ? Number.parseFloat(options.minEffect) : undefined;
	const decision = decideDefaultFlip({
		pairs,
		...(alpha !== undefined && Number.isFinite(alpha) ? { alpha } : {}),
		...(minEffect !== undefined && Number.isFinite(minEffect) ? { minEffect } : {}),
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...decision, pairCount: pairs.length, skipped }, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Default-flip gate (F12.41) over ${pairs.length} paired outcomes${skipped ? ` (${skipped} malformed lines skipped)` : ""}:\n`,
	);
	process.stdout.write(
		`  baseline ${Math.round(decision.aRate * 100)}% vs candidate ${Math.round(decision.bRate * 100)}% (delta ${(decision.delta * 100).toFixed(1)}pp)\n`,
	);
	process.stdout.write(`  McNemar exact p=${decision.mcnemar.pValue.toFixed(4)} (alpha ${alpha ?? 0.05})\n`);
	process.stdout.write(
		`  VERDICT: ${decision.flip ? "FLIP — significantly and practically better" : "DO NOT FLIP"} — ${decision.reason}\n`,
	);
}
