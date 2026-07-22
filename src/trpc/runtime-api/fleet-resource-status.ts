/** F4.53 pure projection of host/fleet/cache/reservation readings into the resource-panel wire shape. */

import type { RuntimeFleetStatusResponse } from "../../core/config-api-contract.js";
import type { ReservationRequest } from "../../core/dispatch-reservations.js";
import type { LmsPsModel } from "../../core/lms-ps-json.js";
import type { LoadedModelDescriptor } from "../../core/lmstudio-loaded-model-descriptors.js";
import type { HostResourceSample } from "../../core/runtime-resource-sampler.js";
import type { PromptCacheStats } from "../../nklein-agent/nklein-prompt-warmth-ledger.js";

export type FleetResourceSnapshot = NonNullable<RuntimeFleetStatusResponse["resources"]>;

function matchingMachineKey(keys: Iterable<string>, candidate: string): string | null {
	const normalized = candidate.trim().toLowerCase();
	for (const key of keys) {
		if (key.trim().toLowerCase() === normalized) return key;
	}
	return null;
}

export function buildFleetResourceSnapshot(input: {
	host: HostResourceSample;
	residentModels: readonly LmsPsModel[];
	loadedDescriptors: readonly LoadedModelDescriptor[];
	fastMemoryBytesByMachine: Readonly<Record<string, number>>;
	promptCache: PromptCacheStats | null;
	reservationHolds: readonly { taskId: string; requests: readonly ReservationRequest[] }[];
}): FleetResourceSnapshot {
	const descriptorByAlias = new Map<string, LoadedModelDescriptor>();
	for (const descriptor of input.loadedDescriptors) {
		descriptorByAlias.set(descriptor.runtimeId, descriptor);
		descriptorByAlias.set(descriptor.modelKey, descriptor);
	}
	// LM Studio spells its local sentinel `local`, while the documented Settings example historically used `Local`.
	// Treat machine keys case-insensitively and prefer the live residency spelling so one physical device never becomes
	// two cards (one with residents/no budget and one with budget/no residents).
	const machineIds = new Set<string>();
	for (const model of input.residentModels) machineIds.add(model.machineId);
	for (const configuredMachineId of Object.keys(input.fastMemoryBytesByMachine)) {
		if (!matchingMachineKey(machineIds, configuredMachineId)) machineIds.add(configuredMachineId);
	}
	const devices = [...machineIds]
		.sort((left, right) => left.localeCompare(right))
		.map((machineId) => {
			const residents = input.residentModels
				.filter((model) => model.machineId === machineId)
				.map((model) => {
					const descriptor = descriptorByAlias.get(model.identifier) ?? descriptorByAlias.get(model.modelKey);
					return {
						identifier: model.identifier,
						modelKey: model.modelKey,
						status: model.status,
						contextLength: model.contextLength,
						sizeBytes: descriptor?.sizeBytes ?? null,
					};
				});
			const configuredKey = matchingMachineKey(Object.keys(input.fastMemoryBytesByMachine), machineId);
			return {
				machineId,
				fastMemoryCapacityBytes: configuredKey ? (input.fastMemoryBytesByMachine[configuredKey] ?? null) : null,
				residentBytes: residents.reduce((sum, resident) => sum + (resident.sizeBytes ?? 0), 0),
				residentBytesKnownCount: residents.filter((resident) => resident.sizeBytes !== null).length,
				residents,
			};
		});
	const reservationTotals = new Map<string, { kind: ReservationRequest["kind"]; key: string; amount: number }>();
	for (const hold of input.reservationHolds) {
		for (const request of hold.requests) {
			const counter = `${request.kind}\u0000${request.key}`;
			const current = reservationTotals.get(counter);
			reservationTotals.set(counter, {
				kind: request.kind,
				key: request.key,
				amount: (current?.amount ?? 0) + request.amount,
			});
		}
	}
	return {
		sampledAt: input.host.sampledAt,
		host: {
			logicalCpuCount: input.host.logicalCpuCount,
			processCpuPercent: input.host.processCpuPercent,
			systemCpuPercent: input.host.systemCpuPercent,
			processRssBytes: input.host.processRssBytes,
			processHeapUsedBytes: input.host.processHeapUsedBytes,
			systemTotalBytes: input.host.systemTotalBytes,
			systemFreeBytes: input.host.systemFreeBytes,
		},
		disk: { totalBytes: input.host.diskTotalBytes, freeBytes: input.host.diskFreeBytes },
		devices,
		promptCache: input.promptCache ?? {
			comparisons: 0,
			perfectHits: 0,
			averageReuseRatio: null,
			latestReuseRatio: null,
			latestAt: null,
		},
		reservations: {
			holderCount: input.reservationHolds.length,
			totals: [...reservationTotals.values()].sort((left, right) =>
				`${left.kind}:${left.key}`.localeCompare(`${right.kind}:${right.key}`),
			),
		},
	};
}
