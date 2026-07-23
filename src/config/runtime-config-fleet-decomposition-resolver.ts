/** F12.110b global → project fleet-decomposition settings normalization and resolution. */

import {
	DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS,
	type RuntimeFleetDecompositionSettings,
} from "../core/api-contract";
import { type ResolvedOverride, resolveScopedOverride } from "../core/scoped-override-resolution";

export function normalizeFleetDecompositionSettings(
	value: unknown,
	fallback: RuntimeFleetDecompositionSettings = DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS,
): RuntimeFleetDecompositionSettings {
	if (!value || typeof value !== "object") return { ...fallback };
	const parsed = value as Partial<Record<keyof RuntimeFleetDecompositionSettings, unknown>>;
	const mode =
		parsed.mode === "auto" ||
		parsed.mode === "smallest" ||
		parsed.mode === "capability_weighted" ||
		parsed.mode === "fixed_target" ||
		parsed.mode === "off"
			? parsed.mode
			: fallback.mode;
	const cleanKey = (key: unknown, fallbackKey: string | null): string | null =>
		typeof key === "string" ? key.trim() || null : fallbackKey;
	return {
		mode,
		fixedTargetModelKey: cleanKey(parsed.fixedTargetModelKey, fallback.fixedTargetModelKey),
		smallestBasis:
			parsed.smallestBasis === "loaded" || parsed.smallestBasis === "supported_floor"
				? parsed.smallestBasis
				: fallback.smallestBasis,
		smallestSupportedModelKey: cleanKey(parsed.smallestSupportedModelKey, fallback.smallestSupportedModelKey),
		autoReshardOnFleetChange:
			typeof parsed.autoReshardOnFleetChange === "boolean"
				? parsed.autoReshardOnFleetChange
				: fallback.autoReshardOnFleetChange,
	};
}

export function normalizeFleetDecompositionSettingsOverride(value: unknown): RuntimeFleetDecompositionSettings | null {
	return value === null || value === undefined ? null : normalizeFleetDecompositionSettings(value);
}

export function areFleetDecompositionSettingsEqual(
	left: RuntimeFleetDecompositionSettings | null | undefined,
	right: RuntimeFleetDecompositionSettings | null | undefined,
): boolean {
	if (left == null || right == null) return left === right;
	return (
		left.mode === right.mode &&
		left.fixedTargetModelKey === right.fixedTargetModelKey &&
		left.smallestBasis === right.smallestBasis &&
		left.smallestSupportedModelKey === right.smallestSupportedModelKey &&
		left.autoReshardOnFleetChange === right.autoReshardOnFleetChange
	);
}

export function resolveFleetDecompositionSettings(input: {
	global: RuntimeFleetDecompositionSettings;
	project?: RuntimeFleetDecompositionSettings | null;
	task?: RuntimeFleetDecompositionSettings | null;
}): ResolvedOverride<RuntimeFleetDecompositionSettings> {
	return resolveScopedOverride(input);
}

export function deriveFleetDecompositionFields(
	defaultValue: unknown,
	overrideValue: unknown,
): {
	fleetDecompositionDefaults: RuntimeFleetDecompositionSettings;
	fleetDecompositionOverride: RuntimeFleetDecompositionSettings | null;
	effectiveFleetDecompositionSettings: RuntimeFleetDecompositionSettings;
} {
	const fleetDecompositionDefaults = normalizeFleetDecompositionSettings(defaultValue);
	const fleetDecompositionOverride = normalizeFleetDecompositionSettingsOverride(overrideValue);
	const resolved = resolveFleetDecompositionSettings({
		global: fleetDecompositionDefaults,
		project: fleetDecompositionOverride,
	});
	return {
		fleetDecompositionDefaults,
		fleetDecompositionOverride,
		effectiveFleetDecompositionSettings: resolved.value,
	};
}
