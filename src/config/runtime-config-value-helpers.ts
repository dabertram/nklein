import type { RuntimeGlobalConfigFileShape } from "./runtime-config-types";

/**
 * Pure config value-handling helpers, extracted from runtime-config.
 *
 * Two concerns, both repeated across the config update/save builders:
 *  - save-MERGE selection — keep the current value unless an update explicitly provided one
 *    ({@link keepUpdatedValue} pass-through; {@link keepNormalizedValue} runs the field normalizer
 *    on an explicitly-provided value);
 *  - diff-gated FILE WRITE — persist a scalar only when it differs from its default OR the existing
 *    file already carried it ({@link assignChangedConfigField}, using {@link hasOwnKey}).
 *
 * Plus the small field normalizers ({@link normalizeShortcutLabel} / {@link normalizeWorkspaceBaseDir}
 * — trim to a non-empty string or null). All pure; covered both by the per-field save-coverage test
 * in runtime-config and by direct unit tests here.
 */

/** Keep the current value unless the update explicitly provided one (undefined = "no update"). */
export function keepUpdatedValue<T>(updateValue: T | undefined, currentValue: T): T {
	return updateValue === undefined ? currentValue : updateValue;
}

/** Like {@link keepUpdatedValue}, but runs `normalize` on an explicitly-provided update value. */
export function keepNormalizedValue<U, T>(updateValue: U | undefined, currentValue: T, normalize: (value: U) => T): T {
	return updateValue === undefined ? currentValue : normalize(updateValue);
}

/** Trim a configured shortcut label to a non-empty string, or null. */
export function normalizeShortcutLabel(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

/** §5.W: trim a configured workspace base dir to a non-empty string, or null to fall back to the home default. */
export function normalizeWorkspaceBaseDir(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * §5.AB: trim the machine-aware loader's per-device RAM budget string (`"name:GB,name:GB"`) to a non-empty
 * string, or null when unset/blank. The device-loader parser interprets the pairs; this only trims.
 */
export function normalizeDeviceRamGb(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * §5.L egress proxy (§6 I3): trim the free-form `sandboxEgressAllowlist` config string (comma/newline-separated
 * hosts) to a non-empty string, or null when unset/blank. `parseEgressAllowlist` splits/dedups the entries at the
 * point of use; this only trims — mirroring `normalizeDeviceRamGb`'s "store the raw string, parse later" style.
 */
export function normalizeSandboxEgressAllowlist(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

/** True when `value` is non-null and owns `key` (its own enumerable/declared property). */
export function hasOwnKey<T extends object>(value: T | null, key: keyof T): boolean {
	if (!value) {
		return false;
	}
	return Object.hasOwn(value, key);
}

/**
 * Diff-gated config-file write (todo §5.U DRY finding): persist a scalar field only when it differs
 * from its default OR the existing file already carried it (so explicit non-default values survive,
 * and defaults stay out of the file). Collapses the many repetitive
 * `if (hasOwnKey(existing, "x") || x !== DEFAULT_X) payload.x = x` blocks for simple
 * `===`-comparable fields. (Profile-coupled timeouts and nested-object fields keep their bespoke
 * comparisons.)
 */
export function assignChangedConfigField<K extends keyof RuntimeGlobalConfigFileShape>(
	payload: RuntimeGlobalConfigFileShape,
	existing: RuntimeGlobalConfigFileShape | null,
	key: K,
	value: RuntimeGlobalConfigFileShape[K],
	defaultValue: RuntimeGlobalConfigFileShape[K],
): void {
	if (hasOwnKey(existing, key) || value !== defaultValue) {
		payload[key] = value;
	}
}
