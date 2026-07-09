import {
	type ConcurrencyConfig,
	type ConcurrencyOverride,
	resolveEffectiveHostConcurrency,
} from "./concurrency-config";
import type { LmsPsModel } from "./lms-ps-json";

export interface LmStudioCapacityModelReport {
	identifier: string;
	modelKey: string;
	hostId: string;
	status: string | null;
	queued: number;
	reportedParallel: number | null;
}

export interface LmStudioCapacityHostReport {
	hostId: string;
	loadedModelCount: number;
	activeModelCount: number;
	queuedRequests: number;
	maxReportedParallel: number | null;
	configuredCap: number | null;
	recommendedCap: number;
	recommendationBasis: "explicit_cap" | "reported_parallel" | "conservative";
	models: LmStudioCapacityModelReport[];
}

export interface LmStudioCapacityReport {
	hosts: LmStudioCapacityHostReport[];
}

function active(model: LmsPsModel): boolean {
	return model.queued > 0 || (model.status !== null && model.status !== "idle");
}

function recommendationForHost(input: {
	configuredCap: number | null;
	maxReportedParallel: number | null;
}): Pick<LmStudioCapacityHostReport, "recommendedCap" | "recommendationBasis"> {
	if (input.configuredCap !== null) {
		return { recommendedCap: input.configuredCap, recommendationBasis: "explicit_cap" };
	}
	if (input.maxReportedParallel !== null && input.maxReportedParallel > 1) {
		return { recommendedCap: input.maxReportedParallel, recommendationBasis: "reported_parallel" };
	}
	return { recommendedCap: 1, recommendationBasis: "conservative" };
}

export function buildLmStudioCapacityReport(input: {
	models: readonly LmsPsModel[];
	global?: ConcurrencyConfig | null;
	override?: ConcurrencyOverride | null;
	hostFallback?: number | null;
}): LmStudioCapacityReport {
	const byHost = new Map<string, LmsPsModel[]>();
	for (const model of input.models) {
		const list = byHost.get(model.machineId);
		if (list) {
			list.push(model);
		} else {
			byHost.set(model.machineId, [model]);
		}
	}
	const hosts = [...byHost.entries()].map(([hostId, models]) => {
		const configuredCap = resolveEffectiveHostConcurrency(hostId, {
			global: input.global,
			override: input.override,
			fallback: input.hostFallback ?? null,
		});
		const maxReportedParallel =
			models
				.map((model) => model.parallel)
				.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
				.sort((left, right) => right - left)[0] ?? null;
		const recommendation = recommendationForHost({ configuredCap, maxReportedParallel });
		return {
			hostId,
			loadedModelCount: models.length,
			activeModelCount: models.filter(active).length,
			queuedRequests: models.reduce((sum, model) => sum + model.queued, 0),
			maxReportedParallel,
			configuredCap,
			...recommendation,
			models: models.map((model) => ({
				identifier: model.identifier,
				modelKey: model.modelKey,
				hostId,
				status: model.status,
				queued: model.queued,
				reportedParallel: model.parallel,
			})),
		};
	});
	return {
		hosts: hosts.sort((left, right) => left.hostId.localeCompare(right.hostId)),
	};
}

export function formatLmStudioCapacityReport(report: LmStudioCapacityReport): string {
	if (report.hosts.length === 0) {
		return "(no loaded LM Studio models observed)\n";
	}
	const lines: string[] = [];
	for (const host of report.hosts) {
		const cap = host.configuredCap === null ? "not set" : String(host.configuredCap);
		const parallel = host.maxReportedParallel === null ? "n/a" : String(host.maxReportedParallel);
		lines.push(
			`Host ${host.hostId}: ${host.loadedModelCount} loaded, ${host.activeModelCount} active, q${host.queuedRequests}, configured cap ${cap}, LM parallel ${parallel}, recommended cap ${host.recommendedCap} (${host.recommendationBasis})`,
		);
		for (const model of host.models) {
			const modelParallel = model.reportedParallel === null ? "n/a" : String(model.reportedParallel);
			lines.push(
				`  ${model.identifier.padEnd(44)} q${model.queued}  ${model.status ?? "?"}  parallel ${modelParallel}`,
			);
		}
	}
	return `${lines.join("\n")}\n`;
}
