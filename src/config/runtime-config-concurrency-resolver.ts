import {
	type ConcurrencyConfig,
	type ConcurrencyOverride,
	normalizeConcurrencyConfig,
	normalizeConcurrencyOverride,
} from "../core/concurrency-config";
import { normalizeMaxConcurrentTasks, normalizeMaxConcurrentTasksOverride } from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The concurrency fields of the resolved runtime config (defaults + project override + effective). */
export type RuntimeConcurrencyConfigFields = Pick<
	RuntimeConfigState,
	| "maxConcurrentTasks"
	| "maxConcurrentTasksOverride"
	| "effectiveMaxConcurrentTasks"
	| "concurrencyDefaults"
	| "concurrencyOverride"
>;

/**
 * Resolve the concurrency block from the global + project configs, including the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U); keeping the default/override/effective trio together in one sub-resolver makes the
 * override semantics explicit and independently testable.
 */
/**
 * Derive the concurrency fields from already-separated default + override raw values. Shared by
 * resolveRuntimeConcurrencyConfig (file-shape input) and createRuntimeConfigStateFromValues (flat-values input)
 * so the normalize + `effective = override ?? default` logic lives in ONE place — the two builders can't drift.
 */
export function deriveConcurrencyFields(
	maxConcurrentTasksValue: unknown,
	maxConcurrentTasksOverrideValue: unknown,
	concurrencyDefaultsValue: Partial<ConcurrencyConfig> | null | undefined,
	concurrencyOverrideValue: ConcurrencyOverride | null | undefined,
): RuntimeConcurrencyConfigFields {
	const maxConcurrentTasks = normalizeMaxConcurrentTasks(maxConcurrentTasksValue);
	const maxConcurrentTasksOverride = normalizeMaxConcurrentTasksOverride(maxConcurrentTasksOverrideValue);
	return {
		maxConcurrentTasks,
		maxConcurrentTasksOverride,
		effectiveMaxConcurrentTasks: maxConcurrentTasksOverride ?? maxConcurrentTasks,
		concurrencyDefaults: normalizeConcurrencyConfig(concurrencyDefaultsValue),
		concurrencyOverride: normalizeConcurrencyOverride(concurrencyOverrideValue),
	};
}

export function resolveRuntimeConcurrencyConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeConcurrencyConfigFields {
	return deriveConcurrencyFields(
		globalConfig?.maxConcurrentTasks,
		projectConfig?.maxConcurrentTasksOverride,
		globalConfig?.concurrencyDefaults,
		projectConfig?.concurrencyOverride,
	);
}
