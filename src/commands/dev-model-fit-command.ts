import { totalmem } from "node:os";
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

export function runDevModelFitCommand(options: DevModelFitOptions = {}): void {
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
