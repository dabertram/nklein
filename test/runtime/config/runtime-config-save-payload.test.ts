import { describe, expect, it } from "vitest";
import {
	buildGlobalConfigFilePayload,
	buildProjectConfigFilePayload,
	buildSavedRuntimeConfigStateValues,
	type SaveRuntimeConfigInput,
} from "../../../src/config/runtime-config-save-payload";

/** A partial input cast — the builders only read the properties they map, so unset ones read as undefined. Values are
 * loosely typed so runtime-behavior tests can pass edge values without fighting the strict field literal unions. */
function input(fields: Record<string, unknown>): SaveRuntimeConfigInput {
	return fields as unknown as SaveRuntimeConfigInput;
}

describe("buildProjectConfigFilePayload (F1.28)", () => {
	it("passes overrides through and coalesces testDrivenModeOverride to null", () => {
		const payload = buildProjectConfigFilePayload(
			input({ selectedAgentIdOverride: "agent-x", testDrivenModeOverride: undefined }),
		);
		expect(payload.selectedAgentIdOverride).toBe("agent-x");
		expect(payload.testDrivenModeOverride).toBeNull();
	});
});

describe("buildSavedRuntimeConfigStateValues (F1.28)", () => {
	it("passes explicit booleans through (normalizeBoolean keeps a set value regardless of default)", () => {
		expect(buildSavedRuntimeConfigStateValues(input({ developerModeEnabled: true })).developerModeEnabled).toBe(true);
		expect(buildSavedRuntimeConfigStateValues(input({ developerModeEnabled: false })).developerModeEnabled).toBe(
			false,
		);
	});

	it("maps hardTaskRoutingMode: only 'wait_for_best' is preserved, everything else → attempt_with_available", () => {
		expect(
			buildSavedRuntimeConfigStateValues(input({ hardTaskRoutingMode: "wait_for_best" })).hardTaskRoutingMode,
		).toBe("wait_for_best");
		expect(
			buildSavedRuntimeConfigStateValues(input({ hardTaskRoutingMode: "anything_else" })).hardTaskRoutingMode,
		).toBe("attempt_with_available");
		expect(buildSavedRuntimeConfigStateValues(input({})).hardTaskRoutingMode).toBe("attempt_with_available");
	});

	it("treats testDrivenModeEnabled strictly (=== true), so undefined/other → false", () => {
		expect(buildSavedRuntimeConfigStateValues(input({ testDrivenModeEnabled: true })).testDrivenModeEnabled).toBe(
			true,
		);
		expect(buildSavedRuntimeConfigStateValues(input({})).testDrivenModeEnabled).toBe(false);
	});

	it("coalesces unset override fields to null (not undefined) for a stable persisted shape", () => {
		const state = buildSavedRuntimeConfigStateValues(input({}));
		expect(state.selectedAgentIdOverride).toBeNull();
		expect(state.modelRolesOverride).toBeNull();
		expect(state.maxConcurrentTasksOverride).toBeNull();
	});
});

describe("buildGlobalConfigFilePayload (F1.28)", () => {
	it("passes explicit booleans through", () => {
		expect(buildGlobalConfigFilePayload(input({ basicMemoryEnabled: false })).basicMemoryEnabled).toBe(false);
		expect(buildGlobalConfigFilePayload(input({ knowsTodayEnabled: true })).knowsTodayEnabled).toBe(true);
	});
});
