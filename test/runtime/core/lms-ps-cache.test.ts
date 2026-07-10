import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchLmsPsModelsCached, resetLmsPsModelsCacheForTests } from "../../../src/core/lms-ps-json";

const PS_JSON = JSON.stringify([{ identifier: "coder-gpu", modelKey: "qwopus3.5-4b-coder-mtp", status: "idle" }]);

afterEach(() => {
	delete process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
});

describe("fetchLmsPsModelsCached (W0.5 — one subprocess per discovery window)", () => {
	beforeEach(() => {
		resetLmsPsModelsCacheForTests();
	});

	it("spawns the runner once within the TTL window and reuses the snapshot", async () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "60000";
		let calls = 0;
		const runner = async () => {
			calls += 1;
			return { stdout: PS_JSON, exitCode: 0 };
		};
		const first = await fetchLmsPsModelsCached(runner);
		const second = await fetchLmsPsModelsCached(runner);
		expect(calls).toBe(1);
		expect(second).toBe(first); // the SAME snapshot array — a wave shares one read
		expect(first.map((model) => model.identifier)).toEqual(["coder-gpu"]);
	});

	it("bypasses the cache entirely at TTL 0 (the test-runner default), so fakes see every call", async () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "0";
		let calls = 0;
		const runner = async () => {
			calls += 1;
			return { stdout: PS_JSON, exitCode: 0 };
		};
		await fetchLmsPsModelsCached(runner);
		await fetchLmsPsModelsCached(runner);
		expect(calls).toBe(2);
	});

	it("ttlOverrideMs collapses a hot poll loop to one fetch per window (the admission-storm fix)", async () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "60000";
		let calls = 0;
		const runner = async () => {
			calls += 1;
			return { stdout: "[]", exitCode: 0 };
		};
		// Several concurrent admission waiters within one 3s poll window → ONE subprocess.
		await fetchLmsPsModelsCached(runner, 3000);
		await fetchLmsPsModelsCached(runner, 3000);
		await fetchLmsPsModelsCached(runner, 3000);
		expect(calls).toBe(1);
	});

	it("ttlOverrideMs never re-enables caching at TTL 0 (tests stay uncached)", async () => {
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "0";
		let calls = 0;
		const runner = async () => {
			calls += 1;
			return { stdout: "[]", exitCode: 0 };
		};
		await fetchLmsPsModelsCached(runner, 3000);
		await fetchLmsPsModelsCached(runner, 3000);
		expect(calls).toBe(2);
	});
});
