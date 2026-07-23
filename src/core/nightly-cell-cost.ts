import { Buffer } from "node:buffer";

export interface NightlyModelIoCost {
	readonly modelRequests: number;
	readonly requestBytes: number;
	readonly responseBytes: number;
	readonly totalBytes: number;
}

interface JournalShape {
	readonly body?: unknown;
	readonly response?: { readonly fixture?: { readonly response?: unknown } | null } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBytes(value: unknown): number {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
	} catch {
		// Journal evidence must remain reportable even if a future transport attaches a cyclic diagnostic object.
		// The request is still counted; an unmeasurable payload contributes zero rather than crashing the drain.
		return 0;
	}
}

/**
 * Count the exact JSON payload bytes that crossed the simulated model boundary.
 *
 * This is deliberately tokenizer-neutral: aimock has no real model tokenizer, and calling a 4-chars/token estimate
 * "tokens" would manufacture precision. Request count + exact input/response bytes still catches prompt and retry
 * growth deterministically across machines and model profiles.
 */
export function summarizeNightlyModelIo(entries: readonly unknown[]): NightlyModelIoCost {
	let modelRequests = 0;
	let requestBytes = 0;
	let responseBytes = 0;
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		const shaped = entry as JournalShape;
		if (!isRecord(shaped.body) || !Array.isArray(shaped.body.messages)) continue;
		modelRequests += 1;
		requestBytes += jsonBytes(shaped.body);
		responseBytes += jsonBytes(shaped.response?.fixture?.response);
	}
	return { modelRequests, requestBytes, responseBytes, totalBytes: requestBytes + responseBytes };
}

export function parseNightlyModelIoCost(raw: string): NightlyModelIoCost {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`nightly model-I/O cost is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(parsed)) throw new Error("nightly model-I/O cost must be a JSON object");
	const readCount = (key: keyof NightlyModelIoCost): number => {
		const value = parsed[key];
		if (!Number.isSafeInteger(value) || (value as number) < 0) {
			throw new Error(`nightly model-I/O cost ${key} must be a non-negative safe integer`);
		}
		return value as number;
	};
	const modelRequests = readCount("modelRequests");
	const requestBytes = readCount("requestBytes");
	const responseBytes = readCount("responseBytes");
	const totalBytes = readCount("totalBytes");
	if (modelRequests === 0 || requestBytes === 0 || responseBytes === 0) {
		throw new Error(
			"nightly model-I/O cost must contain at least one measurable request and matched response; zero is not evidence of a drained model cell",
		);
	}
	if (totalBytes !== requestBytes + responseBytes) {
		throw new Error(
			`nightly model-I/O cost totalBytes mismatch: ${totalBytes} != ${requestBytes} request + ${responseBytes} response`,
		);
	}
	return { modelRequests, requestBytes, responseBytes, totalBytes };
}

export interface NightlyCostRegression {
	readonly cellId: string;
	readonly metric: "model_requests" | "model_io_bytes";
	readonly baseline: number;
	readonly current: number;
	readonly ratio: number;
	readonly detail: string;
}

/** Ratio + absolute floors keep harmless tiny changes from turning this report into noise. */
export function detectNightlyCostRegressions(
	inputs: readonly {
		readonly cellId: string;
		readonly baseline: NightlyModelIoCost | null;
		readonly current: NightlyModelIoCost;
	}[],
): NightlyCostRegression[] {
	const out: NightlyCostRegression[] = [];
	const consider = (
		cellId: string,
		metric: NightlyCostRegression["metric"],
		baseline: number,
		current: number,
		minimumDelta: number,
	) => {
		if (baseline <= 0) return;
		const ratio = current / baseline;
		if (ratio < 1.5 || current - baseline < minimumDelta) return;
		out.push({
			cellId,
			metric,
			baseline,
			current,
			ratio,
			detail: `${cellId}: ${metric} grew ${ratio.toFixed(2)}× (${baseline} → ${current})`,
		});
	};
	for (const input of inputs) {
		if (!input.baseline) continue;
		consider(input.cellId, "model_requests", input.baseline.modelRequests, input.current.modelRequests, 3);
		consider(input.cellId, "model_io_bytes", input.baseline.totalBytes, input.current.totalBytes, 128 * 1024);
	}
	return out;
}
