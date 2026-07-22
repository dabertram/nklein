import { describe, expect, it } from "vitest";
import { buildFleetResourceSnapshot } from "../../../src/trpc/runtime-api/fleet-resource-status";

describe("buildFleetResourceSnapshot", () => {
	it("groups residency, preserves unknown sizes, and aggregates reservation counters", () => {
		const snapshot = buildFleetResourceSnapshot({
			host: {
				sampledAt: 5,
				logicalCpuCount: 8,
				processCpuPercent: 2,
				systemCpuPercent: 30,
				processRssBytes: 10,
				processHeapUsedBytes: 5,
				systemTotalBytes: 100,
				systemFreeBytes: 40,
				diskTotalBytes: 1_000,
				diskFreeBytes: 300,
			},
			residentModels: [
				{
					identifier: "bonsai",
					modelKey: "prism/bonsai",
					indexedModelIdentifier: null,
					path: null,
					machineId: "m5max",
					isEmbedding: false,
					status: "idle",
					queued: 0,
					parallel: 1,
					trainedForToolUse: true,
					contextLength: 40_000,
				},
				{
					identifier: "ornith",
					modelKey: "ornith",
					indexedModelIdentifier: null,
					path: null,
					machineId: "legion5pro",
					isEmbedding: false,
					status: "idle",
					queued: 0,
					parallel: null,
					trainedForToolUse: null,
					contextLength: 32_000,
				},
			],
			loadedDescriptors: [{ runtimeId: "bonsai", modelKey: "prism/bonsai", isEmbedding: false, sizeBytes: 14 }],
			fastMemoryBytesByMachine: { m5max: 128, legion5pro: 8 },
			promptCache: { comparisons: 2, perfectHits: 1, averageReuseRatio: 0.75, latestReuseRatio: 1, latestAt: 4 },
			reservationHolds: [
				{ taskId: "a", requests: [{ kind: "kv_bytes", key: "m5max", amount: 10 }] },
				{ taskId: "b", requests: [{ kind: "kv_bytes", key: "m5max", amount: 5 }] },
			],
		});
		expect(snapshot.devices).toEqual([
			expect.objectContaining({
				machineId: "legion5pro",
				residentBytes: 0,
				residentBytesKnownCount: 0,
			}),
			expect.objectContaining({ machineId: "m5max", residentBytes: 14, residentBytesKnownCount: 1 }),
		]);
		expect(snapshot.reservations).toEqual({
			holderCount: 2,
			totals: [{ kind: "kv_bytes", key: "m5max", amount: 15 }],
		});
	});

	it("joins the documented Local capacity spelling to LM Studio's lowercase local sentinel", () => {
		const snapshot = buildFleetResourceSnapshot({
			host: {
				sampledAt: 1,
				logicalCpuCount: 1,
				processCpuPercent: null,
				systemCpuPercent: null,
				processRssBytes: 1,
				processHeapUsedBytes: 1,
				systemTotalBytes: 1,
				systemFreeBytes: 1,
				diskTotalBytes: null,
				diskFreeBytes: null,
			},
			residentModels: [
				{
					identifier: "local-model",
					modelKey: "local-model",
					indexedModelIdentifier: null,
					path: null,
					machineId: "local",
					isEmbedding: false,
					status: "idle",
					queued: 0,
					parallel: null,
					trainedForToolUse: null,
					contextLength: 32_000,
				},
			],
			loadedDescriptors: [],
			fastMemoryBytesByMachine: { Local: 128 },
			promptCache: null,
			reservationHolds: [],
		});
		expect(snapshot.devices).toHaveLength(1);
		expect(snapshot.devices[0]).toEqual(
			expect.objectContaining({ machineId: "local", fastMemoryCapacityBytes: 128 }),
		);
	});
});
