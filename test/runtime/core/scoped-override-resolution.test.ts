import { describe, expect, it } from "vitest";
import { resolveScopedOverride } from "../../../src/core/scoped-override-resolution";

describe("resolveScopedOverride (F4.16)", () => {
	it("falls back to global when nothing more specific is set", () => {
		expect(resolveScopedOverride({ global: "fully_dynamic" })).toEqual({ value: "fully_dynamic", source: "global" });
	});

	it("prefers the most specific scope that set a value (task > role > project > global)", () => {
		expect(resolveScopedOverride({ global: "g", project: "p", role: "r", task: "t" })).toEqual({
			value: "t",
			source: "task",
		});
		expect(resolveScopedOverride({ global: "g", project: "p", role: "r" })).toEqual({ value: "r", source: "role" });
		expect(resolveScopedOverride({ global: "g", project: "p" })).toEqual({ value: "p", source: "project" });
	});

	it("treats null/undefined as unset (inherit outward), not as a value", () => {
		expect(resolveScopedOverride({ global: "g", project: null, role: undefined, task: null })).toEqual({
			value: "g",
			source: "global",
		});
		// A null task inherits from role.
		expect(resolveScopedOverride({ global: "g", role: "r", task: null })).toEqual({ value: "r", source: "role" });
	});

	it("carries falsy-but-set values (0, false, '') as real overrides", () => {
		expect(resolveScopedOverride<number>({ global: 5, task: 0 })).toEqual({ value: 0, source: "task" });
		expect(resolveScopedOverride<boolean>({ global: true, project: false })).toEqual({
			value: false,
			source: "project",
		});
	});
});
