/**
 * P17.6 — SIZE THE PREFILL PRIZE before building KV-cache persistence. PURE core.
 *
 * ── WHY THIS EXISTS ──
 * David's question was whether a persistent cache for unloaded models would pay for itself. The research answered
 * "the gap is real" (LM Studio's MLX engine clears its KV store on unload; its llama.cpp wrapper omits
 * `--slot-save-path`), and the approved sequence was explicit: **land cache persistence, MEASURE warm-reload
 * cost, then re-open the swap decision on evidence.** This is the measurement half — and it is deliberately built
 * BEFORE the engine work, because the honest answer to "is this worth doing?" might be no.
 *
 * The per-request telemetry already carries everything needed (`inputTokens`, `outputTokens`, `cacheReadTokens`,
 * `durationMs`, per model). Nothing new had to be instrumented; what was missing was the arithmetic.
 *
 * ── WHAT IT REFUSES TO DO ──
 * Converting tokens into SECONDS is where an analysis like this normally starts lying. Two guards:
 *
 *  1. **The per-token cost is FITTED from observed data, never assumed.** `durationMs ≈ a·inputTokens +
 *     b·outputTokens + c` by least squares, with `c` — fixed per-request overhead — modelled explicitly. Dropping
 *     the intercept would fold that overhead into `a`, inflating the apparent cost of every prompt token and so
 *     OVERSTATING the prize. That is the wrong direction to be wrong in when the number justifies an investment.
 *  2. **It reports `null` rather than a weak number.** Too few samples, a degenerate system, or a physically
 *     impossible negative coefficient all yield no estimate and a stated reason. A confident wrong figure here
 *     buys an engine rewrite; an honest "not enough data yet" costs one more campaign run.
 *
 * ── SAMPLE VS CENSUS ──
 * The telemetry reader is hard-capped at 500 events, so callers usually pass a RECENT SAMPLE. Ratios and
 * per-token rates are valid from a sample; TOTALS are not — they are floors. `sampled` carries that distinction
 * so a caller cannot present a floor as a total by accident.
 */

/** One model request as recorded by the per-request usage telemetry. */
export interface PrefillCostRecord {
	readonly modelKey: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	/** Prompt tokens the provider served from ITS cache — already-avoided prefill. */
	readonly cacheReadTokens: number;
	readonly durationMs: number;
}

export interface PerTokenCostFit {
	readonly msPerInputToken: number;
	readonly msPerOutputToken: number;
	readonly fixedOverheadMs: number;
	readonly samples: number;
}

export interface PrefillCostByModel {
	readonly modelKey: string;
	readonly requests: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	/** Prompt tokens that were NOT served from cache — the work a persistent KV store could avoid repeating. */
	readonly uncachedInputTokens: number;
	/** `cacheReadTokens / inputTokens`, or null when no input tokens were seen. */
	readonly cacheHitRatio: number | null;
	/** Fitted cost model, or null when the data cannot support one. */
	readonly fit: PerTokenCostFit | null;
	/** `uncachedInputTokens × msPerInputToken`, or null without a fit. The prize, in milliseconds. */
	readonly estimatedRecomputeMs: number | null;
	/** Why an estimate is missing. Null when one was produced. */
	readonly estimateUnavailableReason: string | null;
}

export interface PrefillCostAnalysis {
	readonly byModel: readonly PrefillCostByModel[];
	/** True when the caller's records are a capped window rather than every request. */
	readonly sampled: boolean;
	readonly summary: string;
}

/** Below this, a fit is curve-fitting noise rather than measuring anything. */
const MIN_FIT_SAMPLES = 20;
/** Normal-equations determinant below this counts as degenerate (e.g. every request the same shape). */
const MIN_DETERMINANT = 1e-6;

/** Solve a 3×3 system by Gaussian elimination with partial pivoting. Returns null when near-singular. */
function solve3(matrix: number[][], rhs: number[]): number[] | null {
	const a = matrix.map((row, index) => [...row, rhs[index] as number]);
	for (let col = 0; col < 3; col += 1) {
		let pivot = col;
		for (let row = col + 1; row < 3; row += 1) {
			if (Math.abs((a[row] as number[])[col] as number) > Math.abs((a[pivot] as number[])[col] as number)) {
				pivot = row;
			}
		}
		if (Math.abs((a[pivot] as number[])[col] as number) < MIN_DETERMINANT) {
			return null;
		}
		[a[col], a[pivot]] = [a[pivot] as number[], a[col] as number[]];
		const pivotRow = a[col] as number[];
		const pivotValue = pivotRow[col] as number;
		for (let row = 0; row < 3; row += 1) {
			if (row === col) {
				continue;
			}
			const target = a[row] as number[];
			const factor = (target[col] as number) / pivotValue;
			for (let k = col; k < 4; k += 1) {
				target[k] = (target[k] as number) - factor * (pivotRow[k] as number);
			}
		}
	}
	return [
		((a[0] as number[])[3] as number) / ((a[0] as number[])[0] as number),
		((a[1] as number[])[3] as number) / ((a[1] as number[])[1] as number),
		((a[2] as number[])[3] as number) / ((a[2] as number[])[2] as number),
	];
}

/** Least-squares fit of `durationMs ≈ a·input + b·output + c`. Null when the data cannot support one. */
function fitPerTokenCost(records: readonly PrefillCostRecord[]): {
	fit: PerTokenCostFit | null;
	reason: string | null;
} {
	const usable = records.filter(
		(record) => record.durationMs > 0 && record.inputTokens >= 0 && record.outputTokens >= 0,
	);
	if (usable.length < MIN_FIT_SAMPLES) {
		return {
			fit: null,
			reason: `only ${usable.length} usable request(s); ${MIN_FIT_SAMPLES} are required before a per-token cost is anything but noise`,
		};
	}
	let sxx = 0;
	let sxy = 0;
	let sx = 0;
	let syy = 0;
	let sy = 0;
	let sxd = 0;
	let syd = 0;
	let sd = 0;
	for (const record of usable) {
		const x = record.inputTokens;
		const y = record.outputTokens;
		const d = record.durationMs;
		sxx += x * x;
		sxy += x * y;
		sx += x;
		syy += y * y;
		sy += y;
		sxd += x * d;
		syd += y * d;
		sd += d;
	}
	const solution = solve3(
		[
			[sxx, sxy, sx],
			[sxy, syy, sy],
			[sx, sy, usable.length],
		],
		[sxd, syd, sd],
	);
	if (!solution) {
		return {
			fit: null,
			reason:
				"the request shapes are too uniform to separate prompt cost from completion cost (a degenerate system) — vary prompt sizes before trusting a number",
		};
	}
	const [msPerInputToken, msPerOutputToken, fixedOverheadMs] = solution as [number, number, number];
	if (!Number.isFinite(msPerInputToken) || msPerInputToken <= 0) {
		return {
			fit: null,
			reason: `the fit produced a non-positive cost per prompt token (${msPerInputToken.toFixed(6)} ms), which is physically impossible — the sample is too noisy to size the prize`,
		};
	}
	return {
		fit: { msPerInputToken, msPerOutputToken, fixedOverheadMs, samples: usable.length },
		reason: null,
	};
}

export function analysePrefillCost(
	records: readonly PrefillCostRecord[],
	options: { readonly sampled?: boolean } = {},
): PrefillCostAnalysis {
	const sampled = options.sampled ?? false;
	const byKey = new Map<string, PrefillCostRecord[]>();
	for (const record of records) {
		const key = record.modelKey.trim() || "(unknown model)";
		const bucket = byKey.get(key) ?? [];
		bucket.push(record);
		byKey.set(key, bucket);
	}

	const byModel = [...byKey.entries()]
		.map(([modelKey, group]) => {
			const inputTokens = group.reduce((total, record) => total + record.inputTokens, 0);
			const outputTokens = group.reduce((total, record) => total + record.outputTokens, 0);
			const cacheReadTokens = group.reduce((total, record) => total + record.cacheReadTokens, 0);
			// Clamped: a provider reporting more cache reads than prompt tokens must not produce negative work.
			const uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens);
			const { fit, reason } = fitPerTokenCost(group);
			return {
				modelKey,
				requests: group.length,
				inputTokens,
				outputTokens,
				cacheReadTokens,
				uncachedInputTokens,
				cacheHitRatio: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
				fit,
				estimatedRecomputeMs: fit ? uncachedInputTokens * fit.msPerInputToken : null,
				estimateUnavailableReason: reason,
			} satisfies PrefillCostByModel;
		})
		.sort((left, right) => right.uncachedInputTokens - left.uncachedInputTokens);

	const estimated = byModel.filter((entry) => entry.estimatedRecomputeMs !== null);
	const totalEstimatedMs = estimated.reduce((total, entry) => total + (entry.estimatedRecomputeMs ?? 0), 0);
	const scope = sampled
		? "Ratios and per-token rates hold for this sample; TOTALS are floors, since the telemetry read is capped."
		: "Every recorded request was included.";
	const summary =
		byModel.length === 0
			? `No model requests to analyse. ${scope}`
			: estimated.length === 0
				? `${byModel.length} model(s), ${records.length} request(s): no per-token cost could be fitted, so the prefill prize is UNSIZED. ${scope}`
				: `${byModel.length} model(s), ${records.length} request(s): ~${(totalEstimatedMs / 1000).toFixed(1)}s of uncached prefill across ${estimated.length} model(s) with a usable fit. ${scope}`;

	return { byModel, sampled, summary };
}
