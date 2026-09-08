import { getHeapStatistics } from "node:v8";
import {
	decideProcessMemorySampleEmission,
	formatMebibytes,
	type ProcessMemoryEmissionDecision,
	type ProcessMemoryEmissionPolicy,
	type ProcessMemorySample,
} from "../core/process-memory-sampling";
import { recordSelfObservation, type SelfObservationEventInput } from "../telemetry/self-observation-sink";

/**
 * P0.HEAP — the effectful half of process-memory observation: read `process.memoryUsage()`, ask the pure policy
 * whether this reading earns a telemetry row, and record it as a `process_memory_sample` observation. The
 * board-liveness watchdog drives it from its `entered` tick, so the cadence is the watchdog's and the observer
 * only decides which ticks become rows. One observer serves the whole process: the heap is process-wide, and a
 * second workspace's watchdog would otherwise double every row.
 *
 * `retention` carries the in-process retention gauges of the moment (transcript entries, launch configs, …) so a
 * growth curve in the telemetry names its suspects instead of just its size.
 */
export interface ProcessMemoryObserveContext {
	workspacePath: string | null;
	retention?: Readonly<Record<string, number>>;
}

export interface ProcessMemoryObserver {
	observe(context: ProcessMemoryObserveContext): ProcessMemoryEmissionDecision;
}

export interface CreateProcessMemoryObserverOptions {
	record?: (event: SelfObservationEventInput) => void;
	now?: () => number;
	readSample?: (now: number) => ProcessMemorySample;
	policy?: Partial<ProcessMemoryEmissionPolicy>;
}

export const PROCESS_MEMORY_SAMPLE_CATEGORY = "process_memory_sample";

export function readProcessMemorySample(now: number = Date.now()): ProcessMemorySample {
	const usage = process.memoryUsage();
	let heapLimitBytes: number | null = null;
	try {
		const limit = getHeapStatistics().heap_size_limit;
		heapLimitBytes = Number.isFinite(limit) && limit > 0 ? limit : null;
	} catch {
		heapLimitBytes = null;
	}
	return {
		sampledAt: now,
		rssBytes: usage.rss,
		heapUsedBytes: usage.heapUsed,
		heapTotalBytes: usage.heapTotal,
		externalBytes: usage.external,
		arrayBuffersBytes: usage.arrayBuffers,
		heapLimitBytes,
	};
}

export function createProcessMemoryObserver(options: CreateProcessMemoryObserverOptions = {}): ProcessMemoryObserver {
	const record = options.record ?? recordSelfObservation;
	const now = options.now ?? Date.now;
	const readSample = options.readSample ?? readProcessMemorySample;
	let lastEmitted: ProcessMemorySample | null = null;
	return {
		observe(context) {
			const sample = readSample(now());
			const decision = decideProcessMemorySampleEmission({ previous: lastEmitted, sample, policy: options.policy });
			if (!decision.emit) {
				return decision;
			}
			lastEmitted = sample;
			const fractionText =
				decision.heapUsedFraction === null
					? ""
					: ` (${Math.round(decision.heapUsedFraction * 100)}% of the heap limit)`;
			try {
				record({
					signal: "custom",
					severity: decision.severity,
					message: `Process memory: heap ${formatMebibytes(sample.heapUsedBytes)} used${fractionText}, rss ${formatMebibytes(sample.rssBytes)} — ${decision.reason}.`,
					workspacePath: context.workspacePath,
					metadata: {
						category: PROCESS_MEMORY_SAMPLE_CATEGORY,
						reason: decision.reason,
						rssBytes: sample.rssBytes,
						heapUsedBytes: sample.heapUsedBytes,
						heapTotalBytes: sample.heapTotalBytes,
						externalBytes: sample.externalBytes,
						arrayBuffersBytes: sample.arrayBuffersBytes,
						heapLimitBytes: sample.heapLimitBytes,
						heapUsedFraction: decision.heapUsedFraction,
						heapUsedDeltaBytes: decision.heapUsedDeltaBytes,
						uptimeMs: Math.round(process.uptime() * 1000),
						...(context.retention ?? {}),
					},
				});
			} catch {
				// Observability must never become a watchdog failure mode.
			}
			return decision;
		},
	};
}
