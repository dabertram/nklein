import { describe, expect, it } from "vitest";
import {
	buildTaskNKleinSettingsForCreate,
	buildTaskNKleinSettingsForUpdate,
	cloneTaskNKleinSettings,
	parseTaskNKleinReasoningEffort,
} from "../../../src/commands/task/task-nklein-settings";

describe("parseTaskNKleinReasoningEffort", () => {
	it("maps absent→undefined, inherit→null, default→'default', valid effort through, invalid→throws", () => {
		expect(parseTaskNKleinReasoningEffort(undefined)).toBeUndefined();
		expect(parseTaskNKleinReasoningEffort("inherit")).toBeNull();
		expect(parseTaskNKleinReasoningEffort("default")).toBe("default");
		expect(parseTaskNKleinReasoningEffort("high")).toBe("high");
		expect(() => parseTaskNKleinReasoningEffort("bogus")).toThrow(/Invalid !Klein reasoning effort/);
	});
});

describe("cloneTaskNKleinSettings", () => {
	it("returns undefined for undefined input", () => {
		expect(cloneTaskNKleinSettings(undefined)).toBeUndefined();
	});
	it("trims provider/model, drops empties, and preserves a 0 timeout", () => {
		expect(cloneTaskNKleinSettings({ providerId: "  lmstudio  ", modelId: "   " })).toEqual({
			providerId: "lmstudio",
		});
		expect(cloneTaskNKleinSettings({ requestTimeoutMs: 0 })).toEqual({ requestTimeoutMs: 0 });
	});
});

describe("buildTaskNKleinSettingsForCreate", () => {
	it("returns undefined when nothing is set", () => {
		expect(buildTaskNKleinSettingsForCreate({})).toBeUndefined();
		expect(buildTaskNKleinSettingsForCreate({ reasoningEffort: null })).toBeUndefined();
		expect(buildTaskNKleinSettingsForCreate({ providerId: "   " })).toBeUndefined();
	});
	it("includes provided fields; 'default' effort is omitted (not stored)", () => {
		expect(buildTaskNKleinSettingsForCreate({ providerId: "lmstudio", modelId: "m" })).toEqual({
			providerId: "lmstudio",
			modelId: "m",
		});
		expect(buildTaskNKleinSettingsForCreate({ reasoningEffort: "high" })).toEqual({ reasoningEffort: "high" });
		// 'default' is a sentinel (clear to provider default) — kept out of the stored override.
		expect(buildTaskNKleinSettingsForCreate({ reasoningEffort: "default" })).toEqual({});
	});
});

describe("buildTaskNKleinSettingsForUpdate", () => {
	it("returns undefined (leave unchanged) when no field is provided", () => {
		expect(buildTaskNKleinSettingsForUpdate({ modelId: "m" }, {})).toBeUndefined();
	});
	it("clearing the only field returns null (remove the override)", () => {
		expect(buildTaskNKleinSettingsForUpdate({ modelId: "m" }, { modelId: null })).toBeNull();
		expect(buildTaskNKleinSettingsForUpdate({ providerId: "p" }, { providerId: "" })).toBeNull();
	});
	it("sets a new value over the current settings", () => {
		expect(buildTaskNKleinSettingsForUpdate(undefined, { providerId: "lmstudio" })).toEqual({
			providerId: "lmstudio",
		});
		expect(buildTaskNKleinSettingsForUpdate({ providerId: "p" }, { modelId: "m" })).toEqual({
			providerId: "p",
			modelId: "m",
		});
	});
	it("reasoning 'default' clears the effort but PRESERVES an (empty) override; 'inherit' removes it entirely", () => {
		// 'default' ⇒ drop effort but keep the override object present (empty) so the provider-default intent persists.
		expect(buildTaskNKleinSettingsForUpdate({ reasoningEffort: "high" }, { reasoningEffort: "default" })).toEqual({});
		// 'inherit' (null) ⇒ drop effort AND, if nothing else remains, remove the override (null).
		expect(buildTaskNKleinSettingsForUpdate({ reasoningEffort: "high" }, { reasoningEffort: null })).toBeNull();
		expect(buildTaskNKleinSettingsForUpdate({ reasoningEffort: "high" }, { reasoningEffort: "low" })).toEqual({
			reasoningEffort: "low",
		});
	});
});
