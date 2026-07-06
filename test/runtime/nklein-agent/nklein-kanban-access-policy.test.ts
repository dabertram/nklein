import { describe, expect, it } from "vitest";
import {
	computeKanbanEnabled,
	parseNKleinRemoteConfigValue,
} from "../../../src/nklein-agent/nklein-kanban-access-policy";

describe("parseNKleinRemoteConfigValue (§5.U extraction)", () => {
	it("parses a valid config, keeping kanbanEnabled", () => {
		expect(parseNKleinRemoteConfigValue('{"kanbanEnabled":true}')).toEqual({ kanbanEnabled: true });
		expect(parseNKleinRemoteConfigValue("{}")).toEqual({});
	});

	it("ignores unknown fields (kanbanEnabled optional)", () => {
		expect(parseNKleinRemoteConfigValue('{"other":1}')).toEqual({});
	});

	it("throws on malformed JSON", () => {
		expect(() => parseNKleinRemoteConfigValue("{ not json")).toThrow();
	});

	it("throws when kanbanEnabled is the wrong type", () => {
		expect(() => parseNKleinRemoteConfigValue('{"kanbanEnabled":"yes"}')).toThrow();
	});
});

describe("computeKanbanEnabled (§5.U extraction)", () => {
	it("is enabled for any non-enterprise customer regardless of config", () => {
		expect(computeKanbanEnabled({ kanbanEnabled: false }, false)).toBe(true);
		expect(computeKanbanEnabled({}, false)).toBe(true);
	});

	it("is enabled when there is no parsed config", () => {
		expect(computeKanbanEnabled(null, true)).toBe(true);
	});

	it("gates an enterprise customer shut unless kanbanEnabled is explicitly true", () => {
		expect(computeKanbanEnabled({ kanbanEnabled: true }, true)).toBe(true);
		expect(computeKanbanEnabled({ kanbanEnabled: false }, true)).toBe(false);
		expect(computeKanbanEnabled({}, true)).toBe(false);
	});
});
