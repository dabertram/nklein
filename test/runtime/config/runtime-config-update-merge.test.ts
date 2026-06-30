import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CONCURRENT_TASKS } from "../../../src/config/runtime-config-defaults";
import type { RuntimeConfigState, RuntimeConfigUpdateInput } from "../../../src/config/runtime-config-types";
import { mergeGlobalRuntimeConfigFields } from "../../../src/config/runtime-config-update-merge";

// keepUpdatedValue/keepNormalizedValue return the current value untouched when an update field is
// omitted, so a partial `current` covering only the asserted fields is sufficient here.
function currentWith(overrides: Partial<RuntimeConfigState>): RuntimeConfigState {
	return { maxConcurrentTasks: 7, developerModeEnabled: false, ...overrides } as RuntimeConfigState;
}

describe("mergeGlobalRuntimeConfigFields", () => {
	it("retains the current value when an update field is omitted", () => {
		const merged = mergeGlobalRuntimeConfigFields(
			{} as RuntimeConfigUpdateInput,
			currentWith({ maxConcurrentTasks: 7 }),
		);
		expect(merged.maxConcurrentTasks).toBe(7);
	});

	it("applies an update field when provided", () => {
		const merged = mergeGlobalRuntimeConfigFields(
			{ maxConcurrentTasks: 4 } as RuntimeConfigUpdateInput,
			currentWith({ maxConcurrentTasks: 7 }),
		);
		expect(merged.maxConcurrentTasks).toBe(4);
	});

	it("normalizes an invalid update back to a safe value", () => {
		const merged = mergeGlobalRuntimeConfigFields(
			{ maxConcurrentTasks: -3 } as RuntimeConfigUpdateInput,
			currentWith({ maxConcurrentTasks: 7 }),
		);
		// A non-positive concurrency is rejected by the normalizer and falls back to the default.
		expect(merged.maxConcurrentTasks).toBe(DEFAULT_MAX_CONCURRENT_TASKS);
	});

	it("emits only global-scoped fields, leaving project overrides and shortcuts to the caller", () => {
		const merged = mergeGlobalRuntimeConfigFields({} as RuntimeConfigUpdateInput, currentWith({}));
		expect(merged).not.toHaveProperty("codeEmbeddingOverride");
		expect(merged).not.toHaveProperty("maxConcurrentTasksOverride");
		expect(merged).not.toHaveProperty("shortcuts");
	});
});
