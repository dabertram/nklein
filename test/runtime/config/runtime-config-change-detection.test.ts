import { describe, expect, it } from "vitest";
import {
	RUNTIME_CONFIG_DERIVED_FIELD_KEYS,
	RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS,
	RUNTIME_PROJECT_CONFIG_CHANGE_FIELD_KEYS,
	type RuntimeConfigChangeComparable,
	type RuntimeConfigChangeField,
	runtimeConfigStateHasChanges,
} from "../../../src/config/runtime-config-change-detection";

const globalKeys = RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS.map((f) => f.key);
const projectKeys = RUNTIME_PROJECT_CONFIG_CHANGE_FIELD_KEYS;

describe("runtime-config change-field registries — structural invariants", () => {
	it("the project change set is a superset of the global change set (project = global + overrides)", () => {
		for (const key of globalKeys) {
			expect(projectKeys).toContain(key);
		}
		expect(projectKeys.length).toBeGreaterThan(globalKeys.length);
	});

	// The load-back safety invariant: a field is EITHER derived (recomputed on load, never diffed) OR change-detected —
	// never both. An overlap would diff a field a save never round-trips → false "changed" every save.
	it("the change-detected keys are disjoint from the derived/excluded keys", () => {
		const derived = new Set<string>(RUNTIME_CONFIG_DERIVED_FIELD_KEYS);
		for (const key of projectKeys) {
			expect(derived.has(key), `field "${key}" is both change-detected and derived`).toBe(false);
		}
	});

	it("has no duplicate keys in either registry", () => {
		expect(new Set(globalKeys).size).toBe(globalKeys.length);
		expect(new Set(projectKeys).size).toBe(projectKeys.length);
	});
});

describe("runtimeConfigStateHasChanges — OR-over-fields contract", () => {
	const field = (key: string): RuntimeConfigChangeField =>
		({
			key,
			changed: (next, current) =>
				(next as Record<string, unknown>)[key] !== (current as Record<string, unknown>)[key],
		}) as RuntimeConfigChangeField;
	const cmp = (o: Record<string, unknown>) => o as unknown as RuntimeConfigChangeComparable;

	it("returns false when every field is equal", () => {
		expect(runtimeConfigStateHasChanges([field("a"), field("b")], cmp({ a: 1, b: 2 }), cmp({ a: 1, b: 2 }))).toBe(
			false,
		);
	});

	it("returns true when any single field differs", () => {
		expect(runtimeConfigStateHasChanges([field("a"), field("b")], cmp({ a: 1, b: 9 }), cmp({ a: 1, b: 2 }))).toBe(
			true,
		);
	});

	it("returns false for an empty field set (nothing to compare)", () => {
		expect(runtimeConfigStateHasChanges([], cmp({ a: 1 }), cmp({ a: 2 }))).toBe(false);
	});

	it("honors a field's custom equality (a deep-equal field is not 'changed' for equal-by-value objects)", () => {
		const deepField = field("roles"); // reuse the helper (typed key: string), but with a deep-equal comparator:
		deepField.changed = (next, current) =>
			JSON.stringify((next as Record<string, unknown>).roles) !==
			JSON.stringify((current as Record<string, unknown>).roles);
		expect(runtimeConfigStateHasChanges([deepField], cmp({ roles: { x: 1 } }), cmp({ roles: { x: 1 } }))).toBe(false);
		expect(runtimeConfigStateHasChanges([deepField], cmp({ roles: { x: 1 } }), cmp({ roles: { x: 2 } }))).toBe(true);
	});
});
