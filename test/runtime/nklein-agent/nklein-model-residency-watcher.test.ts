import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createModelResidencyWatcher,
	type ModelResidencyWatcherDeps,
} from "../../../src/nklein-agent/nklein-model-residency-watcher";

const ENV = "NKLEIN_RESIDENCY_HEARTBEAT";
const savedEnv = process.env[ENV];

function deps(over: Partial<ModelResidencyWatcherDeps> = {}): ModelResidencyWatcherDeps {
	return {
		getLaunchConfig: () => ({ baseUrl: "http://x:1234/v1", modelId: "m" }),
		getTaskEntry: () => null,
		clearTaskTimeouts: vi.fn(),
		abortTaskSession: vi.fn(() => Promise.resolve()),
		recordObservation: vi.fn(),
		emitTaskFailure: vi.fn(),
		...over,
	};
}

beforeEach(() => {
	delete process.env[ENV];
});
afterEach(() => {
	if (savedEnv === undefined) delete process.env[ENV];
	else process.env[ENV] = savedEnv;
});

describe("createModelResidencyWatcher — begin gate (§5.U extraction)", () => {
	it("does nothing (no launch-config lookup) when the heartbeat flag is off", () => {
		const getLaunchConfig = vi.fn(() => ({ baseUrl: "http://x:1234/v1", modelId: "m" }));
		const watcher = createModelResidencyWatcher(deps({ getLaunchConfig }));
		watcher.begin("t1"); // flag off → returns before touching deps
		expect(getLaunchConfig).not.toHaveBeenCalled();
	});

	it("does not start a watch when the launch config lacks a base URL or model id", () => {
		process.env[ENV] = "1";
		const getTaskEntry = vi.fn(() => null);
		const watcher = createModelResidencyWatcher(
			deps({ getLaunchConfig: () => ({ baseUrl: "", modelId: "" }), getTaskEntry }),
		);
		watcher.begin("t1"); // no baseUrl/modelId → returns before starting the heartbeat
		// stop on a task that never started a heartbeat is a safe no-op.
		expect(() => watcher.stop("t1")).not.toThrow();
		expect(getTaskEntry).not.toHaveBeenCalled();
	});
});

describe("createModelResidencyWatcher — stop (§5.U extraction)", () => {
	it("stop is a no-op for an unwatched task", () => {
		const watcher = createModelResidencyWatcher(deps());
		expect(() => watcher.stop("never-started")).not.toThrow();
	});
});
