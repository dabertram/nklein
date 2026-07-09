import { describe, expect, it } from "vitest";
import { evaluateFleetHostObservation } from "../../../src/core/fleet-host-observation";

describe("evaluateFleetHostObservation", () => {
	it("passes when observed models span the required number of hosts", () => {
		const result = evaluateFleetHostObservation({
			seenModels: ["architect", "worker", "reviewer"],
			machineByModelId: new Map([
				["architect", "local"],
				["worker", "m4mini"],
				["reviewer", "legion"],
			]),
			minHosts: 2,
		});

		expect(result.observed).toBe(true);
		expect(result.hostCount).toBe(3);
		expect(result.modelsByHost).toEqual([
			{ hostId: "legion", models: ["reviewer"] },
			{ hostId: "local", models: ["architect"] },
			{ hostId: "m4mini", models: ["worker"] },
		]);
	});

	it("fails when role usage stayed on one host", () => {
		const result = evaluateFleetHostObservation({
			seenModels: ["architect", "worker"],
			machineByModelId: new Map([
				["architect", "local"],
				["worker", "local"],
			]),
		});

		expect(result.observed).toBe(false);
		expect(result.minHosts).toBe(2);
		expect(result.hostCount).toBe(1);
	});

	it("does not count unresolved models as host spread", () => {
		const result = evaluateFleetHostObservation({
			seenModels: ["architect", "unknown-worker", " "],
			machineByModelId: new Map([["architect", "local"]]),
			minHosts: 2,
		});

		expect(result.observed).toBe(false);
		expect(result.hostCount).toBe(1);
		expect(result.unresolvedModels).toEqual(["unknown-worker"]);
	});

	it("normalizes invalid host requirements to a safe minimum", () => {
		const result = evaluateFleetHostObservation({
			seenModels: ["architect"],
			machineByModelId: new Map([["architect", "local"]]),
			minHosts: 0,
		});

		expect(result.observed).toBe(true);
		expect(result.minHosts).toBe(1);
	});
});
