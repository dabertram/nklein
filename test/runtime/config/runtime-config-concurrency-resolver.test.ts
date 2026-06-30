import { describe, expect, it } from "vitest";
import { resolveRuntimeConcurrencyConfig } from "../../../src/config/runtime-config-concurrency-resolver";
import { normalizeMaxConcurrentTasks } from "../../../src/config/runtime-config-normalizers";
import type {
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "../../../src/config/runtime-config-types";

const globalCfg = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;
const projectCfg = (partial: Partial<RuntimeProjectConfigFileShape>): RuntimeProjectConfigFileShape =>
	partial as RuntimeProjectConfigFileShape;

describe("resolveRuntimeConcurrencyConfig", () => {
	it("uses the default when there is no project override (effective === default)", () => {
		const result = resolveRuntimeConcurrencyConfig(globalCfg({ maxConcurrentTasks: 4 }), null);
		expect(result.maxConcurrentTasks).toBe(4);
		expect(result.maxConcurrentTasksOverride).toBeNull();
		expect(result.effectiveMaxConcurrentTasks).toBe(4);
	});

	it("lets a project override win for the effective value (default still reported)", () => {
		const result = resolveRuntimeConcurrencyConfig(
			globalCfg({ maxConcurrentTasks: 4 }),
			projectCfg({ maxConcurrentTasksOverride: 2 }),
		);
		expect(result.maxConcurrentTasks).toBe(4);
		expect(result.maxConcurrentTasksOverride).toBe(2);
		expect(result.effectiveMaxConcurrentTasks).toBe(2);
	});

	it("defaults both maxConcurrentTasks and the concurrency config for null inputs", () => {
		const result = resolveRuntimeConcurrencyConfig(null, null);
		expect(result.maxConcurrentTasks).toBe(normalizeMaxConcurrentTasks(undefined));
		expect(result.effectiveMaxConcurrentTasks).toBe(result.maxConcurrentTasks);
		expect(result.concurrencyOverride).toBeNull();
		expect(result.concurrencyDefaults).toBeTypeOf("object");
	});

	it("exposes exactly the five concurrency fields", () => {
		expect(Object.keys(resolveRuntimeConcurrencyConfig(null, null)).sort()).toEqual([
			"concurrencyDefaults",
			"concurrencyOverride",
			"effectiveMaxConcurrentTasks",
			"maxConcurrentTasks",
			"maxConcurrentTasksOverride",
		]);
	});
});
