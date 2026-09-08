import { describe, expect, it } from "vitest";
import {
	type AutoPoolCandidate,
	selectAutoPoolCandidates,
	widenWorkerPoolWithAutoPool,
} from "../../../src/core/worker-auto-pool";

/**
 * P0.AUDIT0904 leg 25: the auto-pool ran inline inside `handleStartTaskSession` and could only be exercised by
 * starting a real task against a real fleet. Two decisions live in it and both are pure — which loaded models are
 * eligible, and how they join the configured pool.
 */
const candidate = (modelId: string, role: string | null = null): AutoPoolCandidate => ({
	role,
	entry: { key: `key:${modelId}`, modelId },
});

describe("selectAutoPoolCandidates", () => {
	const machines = new Map([
		["on-legion", "legion"],
		["on-m4", "m4mini"],
	]);

	it("takes nothing when the auto-pool is disabled", () => {
		expect(
			selectAutoPoolCandidates([candidate("on-legion")], {
				enabled: false,
				hostAllowlist: new Set(),
				machineIdByModelId: machines,
			}),
		).toEqual([]);
	});

	it("takes only models with NO configured role — another role's model is not spare capacity", () => {
		const taken = selectAutoPoolCandidates([candidate("on-legion"), candidate("on-m4", "reviewer")], {
			enabled: true,
			hostAllowlist: new Set(),
			machineIdByModelId: machines,
		});
		expect(taken.map((entry) => entry.entry.modelId)).toEqual(["on-legion"]);
	});

	it("reads an EMPTY allowlist as every machine, not none", () => {
		const taken = selectAutoPoolCandidates([candidate("on-legion"), candidate("on-m4")], {
			enabled: true,
			hostAllowlist: new Set(),
			machineIdByModelId: machines,
		});
		expect(taken).toHaveLength(2);
	});

	it("honours a non-empty allowlist, and treats an unmapped model as local", () => {
		const taken = selectAutoPoolCandidates([candidate("on-legion"), candidate("on-m4"), candidate("unmapped")], {
			enabled: true,
			hostAllowlist: new Set(["legion", "local"]),
			machineIdByModelId: machines,
		});
		expect(taken.map((entry) => entry.entry.modelId)).toEqual(["on-legion", "unmapped"]);
	});
});

describe("widenWorkerPoolWithAutoPool", () => {
	it("returns the configured pool untouched when there is nothing to absorb", () => {
		const configured = [candidate("configured")];
		const widened = widenWorkerPoolWithAutoPool(configured, []);
		expect(widened.pool.map((entry) => entry.entry.modelId)).toEqual(["configured"]);
		expect(widened.absorbed).toEqual([]);
	});

	it("puts the CONFIGURED pool first — the operator's choice is a preference, not a coincidence", () => {
		const widened = widenWorkerPoolWithAutoPool([candidate("configured")], [candidate("loaded")]);
		expect(widened.pool.map((entry) => entry.entry.modelId)).toEqual(["configured", "loaded"]);
		expect(widened.absorbed.map((entry) => entry.entry.modelId)).toEqual(["loaded"]);
	});

	it("never absorbs a model the configured pool already holds", () => {
		const widened = widenWorkerPoolWithAutoPool([candidate("shared")], [candidate("shared"), candidate("extra")]);
		expect(widened.pool.map((entry) => entry.entry.modelId)).toEqual(["shared", "extra"]);
		expect(widened.absorbed.map((entry) => entry.entry.modelId)).toEqual(["extra"]);
	});

	it("absorbs a repeated candidate once", () => {
		const widened = widenWorkerPoolWithAutoPool([], [candidate("dup"), candidate("dup")]);
		expect(widened.absorbed).toHaveLength(1);
		expect(widened.pool).toHaveLength(1);
	});

	it("reports an EMPTY absorbed list when it changed nothing — the evidence record gates on exactly that", () => {
		// The observation says "the auto pool actually WIDENED a configured pool". If `absorbed` were the whole
		// pool, that record would fire on every start and mean nothing.
		const widened = widenWorkerPoolWithAutoPool([candidate("a"), candidate("b")], [candidate("a")]);
		expect(widened.absorbed).toEqual([]);
		expect(widened.pool).toHaveLength(2);
	});
});
