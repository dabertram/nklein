import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { type ModelCandidate, rankModelCandidatesByFit } from "../core/model-candidate-ranking";
import { estimateModelResidency, fitModelResidency, type ModelArchitecture } from "../core/model-residency-sizing";

/**
 * P25.3 phase 1 consumer — `nklein dev model-fit`: will this model fit on this machine at the context we serve?
 *
 * The question every later phase of the full-auto lifecycle has to answer before it downloads anything, exposed
 * on its own so it is useful (and checkable against reality) long before any of that exists.
 *
 * Budget precedence is deliberate: an explicitly declared budget wins, then `NKLEIN_DEVICE_RAM_GB` — the same
 * variable the existing machine-aware loader already gates on, so one declaration governs both — and only then
 * total physical RAM, which is reported as the weak fallback it is. Sizing against total RAM silently assumes
 * the machine is otherwise idle, and on this fleet it never is.
 */

const BYTES_PER_GIB = 1024 ** 3;

export interface DevModelFitOptions {
	params?: string;
	quant?: string;
	context?: string;
	budgetGb?: string;
	layers?: string;
	kvHeads?: string;
	headDim?: string;
	shortlist?: string;
	json?: boolean;
}

function positiveNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveBudget(options: DevModelFitOptions): { bytes: number; source: string } {
	const declared = Number(options.budgetGb);
	if (Number.isFinite(declared) && declared > 0) {
		return { bytes: declared * BYTES_PER_GIB, source: "--budget-gb" };
	}
	const envBudget = Number(process.env.NKLEIN_DEVICE_RAM_GB);
	if (Number.isFinite(envBudget) && envBudget > 0) {
		return { bytes: envBudget * BYTES_PER_GIB, source: "NKLEIN_DEVICE_RAM_GB" };
	}
	return {
		bytes: totalmem(),
		source: "total physical RAM (WEAK: assumes an otherwise-idle machine — declare NKLEIN_DEVICE_RAM_GB instead)",
	};
}

/**
 * P25.3 phase 2 — rank a research shortlist by what this host can actually run.
 *
 * Reuses the SAME budget precedence as the single-model path, so a shortlist and a one-off check can never
 * disagree about how much memory this machine has.
 */
function runShortlist(options: DevModelFitOptions & { shortlist: string }): void {
	let candidates: ModelCandidate[];
	try {
		const parsed: unknown = JSON.parse(readFileSync(options.shortlist, "utf8"));
		if (!Array.isArray(parsed)) {
			throw new Error("expected a JSON array of candidates");
		}
		candidates = parsed as ModelCandidate[];
	} catch (error) {
		process.stdout.write(`Could not read a candidate array from ${options.shortlist}: ${String(error)}\n`);
		process.exitCode = 1;
		return;
	}

	const contextTokens = positiveNumber(options.context, 32_768);
	const budget = resolveBudget(options);
	const result = rankModelCandidatesByFit({ candidates, budgetBytes: budget.bytes, contextTokens });

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...result, budgetSource: budget.source }, null, 2)}\n`);
		return;
	}
	const gib = (bytes: number) => `${(bytes / BYTES_PER_GIB).toFixed(2)} GiB`;
	process.stdout.write(`budget: ${gib(budget.bytes)} via ${budget.source}\n`);
	process.stdout.write(`${result.summary}\n\n`);
	for (const entry of result.ranked) {
		process.stdout.write(`${entry.tier.toUpperCase().padEnd(32)} ${entry.candidate.key}\n`);
		process.stdout.write(`  ${gib(entry.fit.estimate.totalBytes)} total — ${entry.fit.reason}\n`);
		for (const note of entry.notes) {
			process.stdout.write(`  ⚠️ ${note}\n`);
		}
	}
}

export function runDevModelFitCommand(options: DevModelFitOptions = {}): void {
	if (options.shortlist) {
		runShortlist({ ...options, shortlist: options.shortlist });
		return;
	}
	const paramB = positiveNumber(options.params, 8);
	const weightBitsPerParam = positiveNumber(options.quant, 4);
	const contextTokens = positiveNumber(options.context, 32_768);

	// An architecture counts only if ALL THREE parts are given: two of three cannot produce a KV figure, and
	// filling the third with a default would silently relabel a guess as `declared_architecture`.
	const layers = Number(options.layers);
	const kvHeads = Number(options.kvHeads);
	const headDim = Number(options.headDim);
	const architecture: ModelArchitecture | undefined =
		Number.isFinite(layers) && Number.isFinite(kvHeads) && Number.isFinite(headDim)
			? { layers, kvHeads, headDim }
			: undefined;

	const estimate = estimateModelResidency({
		paramB,
		weightBitsPerParam,
		contextTokens,
		...(architecture ? { architecture } : {}),
	});
	const budget = resolveBudget(options);
	const fit = fitModelResidency(estimate, budget.bytes);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ fit, budgetSource: budget.source }, null, 2)}\n`);
		return;
	}

	const gib = (bytes: number) => `${(bytes / BYTES_PER_GIB).toFixed(2)} GiB`;
	process.stdout.write(
		`${paramB}B @ ${weightBitsPerParam}-bit, ${contextTokens.toLocaleString()} ctx — basis: ${estimate.basis}\n`,
	);
	process.stdout.write(`  weights  ${gib(estimate.weightsBytes)}\n`);
	process.stdout.write(
		`  KV cache ${gib(estimate.kvCacheBytes)}  (${(estimate.kvShareOfTotal * 100).toFixed(0)}% of total)\n`,
	);
	process.stdout.write(`  overhead ${gib(estimate.overheadBytes)}\n`);
	process.stdout.write(`  TOTAL    ${gib(estimate.totalBytes)}\n\n`);
	process.stdout.write(`budget: ${gib(budget.bytes)} via ${budget.source}\n`);
	process.stdout.write(`VERDICT: ${fit.verdict.toUpperCase()} — ${fit.reason}\n`);
	for (const caveat of estimate.caveats) {
		process.stdout.write(`  ⚠️ ${caveat}\n`);
	}
}
