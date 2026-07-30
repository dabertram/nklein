import { MODEL_USAGE_CATEGORY } from "../core/card-tracking-coverage";
import { analysePrefillCost, type PrefillCostRecord } from "../core/prefill-cost-analysis";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";

/**
 * P17.6 — `nklein dev prefill-cost`: how much time goes into prompt tokens we recompute?
 *
 * This is the EVIDENCE half of David's approved sequence ("land cache persistence, measure warm-reload cost, then
 * re-open the swap decision on evidence"). It answers the only question that should authorise the engine work:
 * **how large is the prize?** Deliberately built before the engine change, because "not worth it" is a legitimate
 * and cheap answer.
 *
 * It invents no instrumentation — the per-request usage telemetry already carries input/output/cache-read tokens
 * and a duration per model. What was missing was the arithmetic, which lives in the pure core.
 *
 * ⚠️ **The read is CAPPED at 500 events**, so this is a RECENT SAMPLE, not a census. Ratios and per-token rates
 * are valid from a sample; totals are floors. The core is told `sampled: true` so its own summary says so — a
 * floor presented as a total is exactly how a measurement turns into a bad investment case.
 */

interface UsageMetadata {
	readonly inputTokens?: unknown;
	readonly outputTokens?: unknown;
	readonly cacheReadTokens?: unknown;
	readonly durationMs?: unknown;
	readonly category?: unknown;
	readonly granularity?: unknown;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function runDevPrefillCostCommand(options: { json?: boolean } = {}): Promise<void> {
	const events = await readSelfObservationEvents({ limit: 500, category: MODEL_USAGE_CATEGORY });
	const records: PrefillCostRecord[] = [];
	let skippedWithoutUsage = 0;

	for (const event of events) {
		const metadata = (event.metadata ?? {}) as UsageMetadata;
		if (metadata.granularity !== "perRequest") {
			continue;
		}
		const inputTokens = numberOrNull(metadata.inputTokens);
		const durationMs = numberOrNull(metadata.durationMs);
		if (inputTokens === null || durationMs === null) {
			// A request whose usage the provider never reported cannot be priced. COUNTED, never treated as zero —
			// silently dropping it would shrink the measured prize without anyone noticing.
			skippedWithoutUsage += 1;
			continue;
		}
		records.push({
			modelKey: event.modelId ?? "(unknown model)",
			inputTokens,
			outputTokens: numberOrNull(metadata.outputTokens) ?? 0,
			cacheReadTokens: numberOrNull(metadata.cacheReadTokens) ?? 0,
			durationMs,
		});
	}

	const analysis = analysePrefillCost(records, { sampled: events.length >= 500 });

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...analysis, skippedWithoutUsage }, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${analysis.summary}\n`);
	if (skippedWithoutUsage > 0) {
		process.stdout.write(
			`${skippedWithoutUsage} request(s) reported no usage payload and were EXCLUDED — the figures below are a floor.\n`,
		);
	}
	process.stdout.write("\n");

	for (const model of analysis.byModel) {
		const hit = model.cacheHitRatio === null ? "n/a" : `${(model.cacheHitRatio * 100).toFixed(1)}%`;
		process.stdout.write(`${model.modelKey} — ${model.requests} request(s)\n`);
		process.stdout.write(
			`  prompt ${model.inputTokens} tok (cache hit ${hit}) · uncached ${model.uncachedInputTokens} tok · completion ${model.outputTokens} tok\n`,
		);
		if (model.fit && model.estimatedRecomputeMs !== null) {
			process.stdout.write(
				`  fit: ${model.fit.msPerInputToken.toFixed(4)} ms/prompt-tok, ${model.fit.msPerOutputToken.toFixed(3)} ms/completion-tok, ${model.fit.fixedOverheadMs.toFixed(0)} ms fixed (n=${model.fit.samples})\n`,
			);
			process.stdout.write(
				`  ⇒ ~${(model.estimatedRecomputeMs / 1000).toFixed(1)}s spent re-prefilling tokens a persistent KV cache could have kept\n`,
			);
		} else {
			process.stdout.write(`  ⇒ NO estimate: ${model.estimateUnavailableReason}\n`);
		}
		process.stdout.write("\n");
	}

	process.stdout.write(
		"This sizes the PRIZE only. It does not model the cost of keeping a cache warm, its disk/RAM budget, or the\n" +
			"restore latency that would replace the prefill — those belong to P17.7 and must not be assumed to be zero.\n",
	);
}
