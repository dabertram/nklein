import { type RuntimeNKleinReasoningEffort, runtimeNKleinReasoningEffortSchema } from "../core/api-contract";

/**
 * Tri-state optional-field readers for a persisted NKlein session record, extracted from
 * nklein-session-runtime.
 *
 * Each distinguishes the THREE outcomes a persisted launch-config field needs:
 *  - the key is ABSENT → undefined ("no opinion — inherit the current value");
 *  - present and explicitly null → null ("clear it");
 *  - a VALID typed value → that value.
 *
 * An out-of-type value reads as undefined (ignored, not an error). Pure record reads — the
 * tri-state distinction (which the launch-config merge depends on) is unit-tested.
 */

export function readOptionalString(record: Record<string, unknown>, key: string): string | null | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	if (value === null) {
		return null;
	}
	return typeof value === "string" ? value : undefined;
}

/** Like {@link readOptionalString}, but for a finite number — truncated to an integer. */
export function readOptionalNumber(record: Record<string, unknown>, key: string): number | null | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	if (value === null) {
		return null;
	}
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/** Like {@link readOptionalString}, but zod-validates the value as a reasoning-effort level. */
export function readOptionalReasoningEffort(
	record: Record<string, unknown>,
	key: string,
): RuntimeNKleinReasoningEffort | null | undefined {
	if (!Object.hasOwn(record, key)) {
		return undefined;
	}
	const value = record[key];
	if (value === null) {
		return null;
	}
	const parsed = runtimeNKleinReasoningEffortSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}
