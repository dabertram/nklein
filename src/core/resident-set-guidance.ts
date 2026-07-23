/**
 * F12.77b — turn the real fitness table + downloaded-model catalog into per-host resident-set guidance.
 *
 * This is deliberately pure. It aggregates each model's real role/difficulty cells once (sampleCount is both the
 * evidence count and the number of observed requests), delegates selection to `recommendResidentSet`, and adds only
 * operator-facing copy text. It cannot load or unload anything.
 *
 * TTL semantics matter: LM Studio's `--ttl` is an unconditional idle-time auto-unload. It is not !Klein's internal
 * "eligible for eviction when new work needs capacity" marker. Models which earn a safe warm slot therefore get NO
 * `--ttl`; that preserves weights and prompt caches until capacity pressure makes the guarded residency planner act.
 * A short TTL is mentioned only for one-off probes which should intentionally disappear.
 */

import { stableFitnessModelKey } from "./fitness-routing-evidence";
import type { LmsCatalogModel } from "./lms-model-catalog";
import { MIN_CONTEXT_WINDOW_TOKENS } from "./lms-model-control";
import type { LmsPsModel } from "./lms-ps-json";
import { suggestModelKeepAliveTtl } from "./lmstudio-keep-alive-ttl";
import {
	COLD_LOAD_SECONDS,
	type ExcludedModel,
	type ResidencyCandidate,
	recommendResidentSet,
} from "./resident-set-recommendation";

const GIB = 1024 ** 3;

export interface ResidentSetFitnessSample {
	readonly modelKey: string;
	readonly successCount: number;
	readonly sampleCount: number;
}

export interface ResidentSetGuidanceModel {
	readonly modelId: string;
	readonly sizeBytes: number;
	readonly measuredFitness: number;
	readonly observationCount: number;
	readonly requestCount: number;
	readonly secondsSaved: number;
	readonly alreadyLoaded: boolean;
	/** Copy-only operator command; null when the model is already warm. Never executed by !Klein. */
	readonly loadCommand: string | null;
	/** null means intentionally omit `--ttl` and keep the model resident. */
	readonly ttlSeconds: number | null;
	readonly ttlGuidance: string;
}

export interface ResidentSetHostGuidance {
	readonly hostId: string;
	readonly totalRamBytes: number;
	readonly usableRamBytes: number;
	readonly maxResidentModels: number;
	readonly recommended: ResidentSetGuidanceModel[];
	readonly excluded: ExcludedModel[];
	readonly secondsSaved: number;
	readonly summary: string;
	readonly probeTtlSeconds: number;
	readonly probeTtlGuidance: string;
}

function canonicalModelKey(modelKey: string): string {
	return stableFitnessModelKey(modelKey).trim().toLowerCase();
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function aggregateFitness(
	rows: readonly ResidentSetFitnessSample[],
): Map<string, { successCount: number; sampleCount: number }> {
	const byModel = new Map<string, { successCount: number; sampleCount: number }>();
	for (const row of rows) {
		const key = canonicalModelKey(row.modelKey);
		if (!key) continue;
		const current = byModel.get(key) ?? { successCount: 0, sampleCount: 0 };
		current.successCount += Math.max(0, row.successCount);
		current.sampleCount += Math.max(0, row.sampleCount);
		byModel.set(key, current);
	}
	return byModel;
}

/** Production's warm-retention boundary: larger unified-memory hosts may retain three chat models; others retain one. */
export function residentModelCapForRam(totalRamBytes: number): number {
	return totalRamBytes >= 64 * GIB ? 3 : 1;
}

export function buildResidentSetGuidance(input: {
	readonly fitnessRows: readonly ResidentSetFitnessSample[];
	readonly catalog: readonly LmsCatalogModel[];
	readonly loadedModels: readonly LmsPsModel[];
	/** LM Link's device-id → friendly-name map, so loaded `lms ps --json` rows join `lms ls` catalog devices. */
	readonly deviceNamesById?: ReadonlyMap<string, string>;
	readonly deviceRamBytes: Readonly<Record<string, number>>;
	readonly contextLength?: number;
}): ResidentSetHostGuidance[] {
	const fitnessByModel = aggregateFitness(input.fitnessRows);
	const loadedByHost = new Map<string, Set<string>>();
	for (const model of input.loadedModels) {
		if (model.isEmbedding) continue;
		const hostId = input.deviceNamesById?.get(model.machineId) ?? model.machineId;
		const keys = loadedByHost.get(hostId) ?? new Set<string>();
		keys.add(canonicalModelKey(model.modelKey));
		keys.add(canonicalModelKey(model.identifier));
		loadedByHost.set(hostId, keys);
	}

	const catalogByHost = new Map<string, LmsCatalogModel[]>();
	for (const model of input.catalog) {
		const models = catalogByHost.get(model.device) ?? [];
		models.push(model);
		catalogByHost.set(model.device, models);
	}

	const warmTtl = suggestModelKeepAliveTtl({
		usagePattern: "active_session",
		memoryPressure: "low",
		loadCostSeconds: COLD_LOAD_SECONDS,
		unbounded: true,
	});
	const probeTtl = suggestModelKeepAliveTtl({ usagePattern: "sweep_probe", memoryPressure: "low" });
	const contextLength = Math.max(
		MIN_CONTEXT_WINDOW_TOKENS,
		Math.trunc(input.contextLength ?? MIN_CONTEXT_WINDOW_TOKENS),
	);
	const guidance: ResidentSetHostGuidance[] = [];

	for (const [hostId, totalRamBytes] of Object.entries(input.deviceRamBytes)) {
		if (!Number.isFinite(totalRamBytes) || totalRamBytes <= 0) continue;
		const hostCatalog = catalogByHost.get(hostId) ?? [];
		if (hostCatalog.length === 0) continue;
		const candidates: ResidencyCandidate[] = hostCatalog.map((model) => {
			const evidence = fitnessByModel.get(canonicalModelKey(model.modelKey));
			const sampleCount = evidence?.sampleCount ?? 0;
			return {
				modelId: model.modelKey,
				sizeBytes: Math.round(model.sizeGB * GIB),
				measuredFitness: sampleCount > 0 ? (evidence?.successCount ?? 0) / sampleCount : null,
				observationCount: sampleCount,
				// Each fitness outcome occupies exactly one model×role×difficulty cell, so summing cells counts requests once.
				requestCount: sampleCount,
			};
		});
		const maxResidentModels = residentModelCapForRam(totalRamBytes);
		const recommendation = recommendResidentSet({
			candidates,
			budgetBytes: totalRamBytes,
			maxResidents: maxResidentModels,
		});
		const candidateById = new Map(candidates.map((candidate) => [candidate.modelId, candidate]));
		const loaded = loadedByHost.get(hostId) ?? new Set<string>();
		guidance.push({
			hostId,
			totalRamBytes,
			usableRamBytes: recommendation.bytesAvailable,
			maxResidentModels,
			recommended: recommendation.recommended.map((model) => {
				const candidate = candidateById.get(model.modelId);
				if (!candidate || candidate.measuredFitness === null) {
					throw new Error(`resident-set recommendation lost candidate evidence for ${model.modelId}`);
				}
				const alreadyLoaded = loaded.has(canonicalModelKey(model.modelId));
				return {
					modelId: model.modelId,
					sizeBytes: model.sizeBytes,
					measuredFitness: candidate.measuredFitness,
					observationCount: candidate.observationCount,
					requestCount: candidate.requestCount,
					secondsSaved: model.secondsSaved,
					alreadyLoaded,
					loadCommand: alreadyLoaded
						? null
						: `lms load ${shellQuote(model.modelId)} --context-length ${contextLength}`,
					ttlSeconds: warmTtl.ttlSeconds,
					ttlGuidance:
						"No --ttl while this model stays inside the safe RAM and host-count envelope. LM Studio TTL is a timed auto-unload, so omitting it preserves weights and prompt caches.",
				};
			}),
			excluded: [...recommendation.excluded],
			secondsSaved: recommendation.secondsSaved,
			summary: recommendation.summary,
			probeTtlSeconds: probeTtl.ttlSeconds ?? 60,
			probeTtlGuidance:
				"For an intentional one-off probe only, add --ttl 60 so the probe self-evicts. Do not add it to the warm set.",
		});
	}
	return guidance.sort((left, right) => left.hostId.localeCompare(right.hostId));
}
