import { describe, expect, it } from "vitest";
import type { LmsPsModel } from "../../../src/core/lms-ps-json";
import { buildLmStudioCapacityReport, formatLmStudioCapacityReport } from "../../../src/core/lmstudio-capacity-report";

function model(overrides: Partial<LmsPsModel> & Pick<LmsPsModel, "identifier" | "machineId">): LmsPsModel {
	return {
		identifier: overrides.identifier,
		modelKey: overrides.modelKey ?? overrides.identifier,
		machineId: overrides.machineId,
		isEmbedding: overrides.isEmbedding ?? false,
		status: overrides.status ?? "idle",
		queued: overrides.queued ?? 0,
		parallel: overrides.parallel ?? null,
		trainedForToolUse: overrides.trainedForToolUse ?? null,
		contextLength: overrides.contextLength ?? null,
	};
}

describe("buildLmStudioCapacityReport", () => {
	it("respects explicit per-host caps over reported parallelism", () => {
		const report = buildLmStudioCapacityReport({
			models: [model({ identifier: "big", machineId: "local", parallel: 4 })],
			global: { perProvider: {}, perModel: {}, perHost: { local: 2 } },
		});
		expect(report.hosts[0]).toMatchObject({
			hostId: "local",
			configuredCap: 2,
			recommendedCap: 2,
			recommendationBasis: "explicit_cap",
			maxReportedParallel: 4,
		});
	});

	it("uses LM Studio reported parallelism only when no cap is set", () => {
		const report = buildLmStudioCapacityReport({
			models: [model({ identifier: "big", machineId: "local", parallel: 3 })],
		});
		expect(report.hosts[0]).toMatchObject({
			configuredCap: null,
			recommendedCap: 3,
			recommendationBasis: "reported_parallel",
		});
	});

	it("stays conservative when there is no cap and no reported parallelism", () => {
		const report = buildLmStudioCapacityReport({
			models: [model({ identifier: "small", machineId: "m4mini", status: "generating", queued: 2 })],
		});
		expect(report.hosts[0]).toMatchObject({
			hostId: "m4mini",
			activeModelCount: 1,
			queuedRequests: 2,
			recommendedCap: 1,
			recommendationBasis: "conservative",
		});
	});
});

describe("formatLmStudioCapacityReport", () => {
	it("renders host and model rows", () => {
		const text = formatLmStudioCapacityReport(
			buildLmStudioCapacityReport({
				models: [model({ identifier: "small", machineId: "m4mini", parallel: 1 })],
			}),
		);
		expect(text).toContain("Host m4mini");
		expect(text).toContain("small");
	});
});
