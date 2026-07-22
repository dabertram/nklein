/**
 * F4.53 low-overhead host resource sampler. There is deliberately no timer: the board calls `sample` only while its
 * collapsed-by-default fleet rail is open. CPU is derived from consecutive samples, so the first observation is null
 * rather than a misleading lifetime average. Memory and workspace-volume disk values are instantaneous.
 */

import { statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";

export interface CpuCounterSnapshot {
	atMs: number;
	processMicros: number;
	systemIdleMs: number;
	systemTotalMs: number;
	logicalCpuCount: number;
}

export interface HostResourceSample {
	sampledAt: number;
	logicalCpuCount: number;
	processCpuPercent: number | null;
	systemCpuPercent: number | null;
	processRssBytes: number;
	processHeapUsedBytes: number;
	systemTotalBytes: number;
	systemFreeBytes: number;
	diskTotalBytes: number | null;
	diskFreeBytes: number | null;
}

export function deriveCpuPercent(
	previous: CpuCounterSnapshot | null,
	current: CpuCounterSnapshot,
): { processCpuPercent: number | null; systemCpuPercent: number | null } {
	if (!previous) {
		return { processCpuPercent: null, systemCpuPercent: null };
	}
	const elapsedMs = current.atMs - previous.atMs;
	const processDeltaMicros = current.processMicros - previous.processMicros;
	const systemTotalDelta = current.systemTotalMs - previous.systemTotalMs;
	const systemIdleDelta = current.systemIdleMs - previous.systemIdleMs;
	const processCpuPercent =
		elapsedMs > 0 && processDeltaMicros >= 0
			? Math.min(100, Math.max(0, (processDeltaMicros / (elapsedMs * 1_000 * current.logicalCpuCount)) * 100))
			: null;
	const systemCpuPercent =
		systemTotalDelta > 0 && systemIdleDelta >= 0
			? Math.min(100, Math.max(0, (1 - systemIdleDelta / systemTotalDelta) * 100))
			: null;
	return { processCpuPercent, systemCpuPercent };
}

export interface RuntimeResourceSampler {
	sample(workspacePath: string): Promise<HostResourceSample>;
}

export function createRuntimeResourceSampler(): RuntimeResourceSampler {
	let previousCpu: CpuCounterSnapshot | null = null;
	return {
		async sample(workspacePath) {
			const sampledAt = Date.now();
			const cpuRows = cpus();
			const processUsage = process.cpuUsage();
			const currentCpu: CpuCounterSnapshot = {
				atMs: sampledAt,
				processMicros: processUsage.user + processUsage.system,
				systemIdleMs: cpuRows.reduce((sum, cpu) => sum + cpu.times.idle, 0),
				systemTotalMs: cpuRows.reduce(
					(sum, cpu) => sum + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
					0,
				),
				logicalCpuCount: Math.max(1, cpuRows.length),
			};
			const cpuPercent = deriveCpuPercent(previousCpu, currentCpu);
			previousCpu = currentCpu;
			const memory = process.memoryUsage();
			let diskTotalBytes: number | null = null;
			let diskFreeBytes: number | null = null;
			try {
				const disk = await statfs(workspacePath);
				diskTotalBytes = disk.blocks * disk.bsize;
				diskFreeBytes = disk.bavail * disk.bsize;
			} catch {
				// Best-effort: an unmounted/deleted workspace must not make the fleet rail fail.
			}
			return {
				sampledAt,
				logicalCpuCount: currentCpu.logicalCpuCount,
				...cpuPercent,
				processRssBytes: memory.rss,
				processHeapUsedBytes: memory.heapUsed,
				systemTotalBytes: totalmem(),
				systemFreeBytes: freemem(),
				diskTotalBytes,
				diskFreeBytes,
			};
		},
	};
}
