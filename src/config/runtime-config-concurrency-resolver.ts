import { normalizeConcurrencyConfig, normalizeConcurrencyOverride } from "../core/concurrency-config";
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
export function resolveRuntimeConcurrencyConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeConcurrencyConfigFields {
	const maxConcurrentTasks = normalizeMaxConcurrentTasks(globalConfig?.maxConcurrentTasks);
	const maxConcurrentTasksOverride = normalizeMaxConcurrentTasksOverride(projectConfig?.maxConcurrentTasksOverride);
	return {
		maxConcurrentTasks,
		maxConcurrentTasksOverride,
		effectiveMaxConcurrentTasks: maxConcurrentTasksOverride ?? maxConcurrentTasks,
		concurrencyDefaults: normalizeConcurrencyConfig(globalConfig?.concurrencyDefaults),
		concurrencyOverride: normalizeConcurrencyOverride(projectConfig?.concurrencyOverride),
	};
}
