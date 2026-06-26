import { describe, expect, it } from "vitest";
import {
	arrangeContextForSmartZone,
	renderSmartZoneContext,
	type SmartZonePart,
} from "../../../src/core/context-smart-zone";

function part(id: string, band: SmartZonePart["band"], content: string, priority?: number): SmartZonePart {
	return priority === undefined ? { id, band, content } : { id, band, content, priority };
}

describe("arrangeContextForSmartZone", () => {
	it("orders framing FRONT, reference MIDDLE, and the task LAST (the strong end-zone)", () => {
		const arranged = arrangeContextForSmartZone([
			part("repo_map", "middle", "lots of files"),
			part("task", "back", "implement X and make the tests pass"),
			part("role", "front", "you are a coding agent"),
		]);
		expect(arranged.map((p) => p.id)).toEqual(["role", "repo_map", "task"]);
	});

	it("places the highest-priority FRONT part nearest the very front", () => {
		const arranged = arrangeContextForSmartZone([
			part("tools", "front", "tool contract", 1),
			part("invariants", "front", "never touch cloud", 5),
		]);
		expect(arranged.map((p) => p.id)).toEqual(["invariants", "tools"]);
	});

	it("puts the highest-priority BACK (task) content LAST", () => {
		const arranged = arrangeContextForSmartZone([
			part("acceptance", "back", "npm test must pass", 5),
			part("aside", "back", "minor note", 1),
		]);
		// The most important task content (acceptance) ends up at the very end.
		expect(arranged.map((p) => p.id)).toEqual(["aside", "acceptance"]);
		expect(arranged.at(-1)?.id).toBe("acceptance");
	});

	it("edge-loads the MIDDLE band so critical items avoid the dead center", () => {
		// Sorted desc by priority: m5, m4, m3, m2, m1 → edge-loaded [m5, m3, m1, m2, m4].
		const arranged = arrangeContextForSmartZone([
			part("m1", "middle", "p1", 1),
			part("m2", "middle", "p2", 2),
			part("m3", "middle", "p3", 3),
			part("m4", "middle", "p4", 4),
			part("m5", "middle", "p5", 5),
		]);
		expect(arranged.map((p) => p.id)).toEqual(["m5", "m3", "m1", "m2", "m4"]);
		// The lowest-priority item sits in the dead center; the two highest sit at the edges.
		expect(arranged[2]?.id).toBe("m1");
		expect(arranged[0]?.id).toBe("m5");
		expect(arranged.at(-1)?.id).toBe("m4");
	});

	it("keeps the simple priority-desc middle order when edge-loading is disabled", () => {
		const arranged = arrangeContextForSmartZone(
			[part("m1", "middle", "p1", 1), part("m2", "middle", "p2", 2), part("m3", "middle", "p3", 3)],
			{ edgeLoadMiddle: false },
		);
		expect(arranged.map((p) => p.id)).toEqual(["m3", "m2", "m1"]);
	});

	it("drops empty/blank parts and never mutates the input", () => {
		const input = [part("role", "front", "  "), part("task", "back", "do it")];
		const snapshot = JSON.parse(JSON.stringify(input));
		const arranged = arrangeContextForSmartZone(input);
		expect(arranged.map((p) => p.id)).toEqual(["task"]);
		expect(input).toEqual(snapshot);
	});

	it("is a stable full-stack arrangement: front → edge-loaded middle → task last", () => {
		const arranged = arrangeContextForSmartZone([
			part("history", "middle", "older turns", 1),
			part("task", "back", "the concrete step", 9),
			part("role", "front", "framing", 9),
			part("repo_map", "middle", "symbols", 3),
			part("files", "middle", "long file", 2),
		]);
		// front first, task last, and the most-relevant middle (repo_map) at a strong middle edge (not dead center).
		expect(arranged[0]?.id).toBe("role");
		expect(arranged.at(-1)?.id).toBe("task");
		expect(arranged[1]?.id).toBe("repo_map");
	});
});

describe("renderSmartZoneContext", () => {
	it("joins arranged parts with a blank line by default", () => {
		const text = renderSmartZoneContext([
			part("task", "back", "do the thing"),
			part("role", "front", "you are an agent"),
		]);
		expect(text).toBe("you are an agent\n\ndo the thing");
	});

	it("tag-delimits each section when tagParts is on (Anthropic guidance)", () => {
		const text = renderSmartZoneContext(
			[part("task", "back", "do the thing"), part("role", "front", "you are an agent")],
			{ tagParts: true },
		);
		expect(text).toBe("<role>\nyou are an agent\n</role>\n\n<task>\ndo the thing\n</task>");
	});
});
