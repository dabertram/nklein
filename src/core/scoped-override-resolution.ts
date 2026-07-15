/**
 * F4.16 (§ dynamics-level config) — resolve a setting across the four override SCOPES with a fixed precedence:
 * `task` > `role` > `project` > `global`. The MOST-SPECIFIC scope that actually SET a value wins; a scope that leaves
 * the value unset (`null`/`undefined`) INHERITS from the next scope out. `global` is required, so a resolution always
 * has a value — there is no env-only hidden state, and the winning `source` is returned for "surface the effective
 * level" UIs. Generic, so F4.16 (dynamics level), F4.28 (curated-MCP overrides), role-scoped strictness, etc. all reuse
 * one resolver. PURE + deterministic.
 */

export type OverrideScope = "task" | "role" | "project" | "global";

/** The four scopes' values for one setting. `global` is required; the rest are optional (unset ⇒ inherit outward). */
export interface ScopedOverrideInput<T> {
	global: T;
	project?: T | null;
	role?: T | null;
	task?: T | null;
}

export interface ResolvedOverride<T> {
	/** The effective value after precedence resolution. */
	value: T;
	/** Which scope supplied the winning value (for surfacing the effective source). */
	source: OverrideScope;
}

/** Resolve one setting: task > role > project > global; the most-specific SET (non-null) scope wins. */
export function resolveScopedOverride<T>(input: ScopedOverrideInput<T>): ResolvedOverride<T> {
	if (input.task !== null && input.task !== undefined) {
		return { value: input.task, source: "task" };
	}
	if (input.role !== null && input.role !== undefined) {
		return { value: input.role, source: "role" };
	}
	if (input.project !== null && input.project !== undefined) {
		return { value: input.project, source: "project" };
	}
	return { value: input.global, source: "global" };
}
