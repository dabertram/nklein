import { describe, expect, it } from "vitest";
import { repairJsonStringValue, repairJsonValue } from "../../../src/nklein-agent/nklein-tool-argument-repair";

describe("repairJsonValue", () => {
	it("passes through an already-parsed object/array", () => {
		expect(repairJsonValue({ a: 1 })).toEqual({ ok: true, value: { a: 1 }, strategy: "passthrough" });
		expect(repairJsonValue([1, 2]).strategy).toBe("passthrough");
	});

	it("parses plain JSON strings", () => {
		expect(repairJsonValue('{"a":1}')).toMatchObject({ ok: true, value: { a: 1 }, strategy: "parsed" });
	});

	it("unwraps ```json code fences", () => {
		expect(repairJsonValue('```json\n{"a":1}\n```')).toMatchObject({ value: { a: 1 }, strategy: "unfenced" });
	});

	it("extracts JSON embedded in prose", () => {
		expect(repairJsonValue('Sure! Here it is: {"a":1} hope that helps')).toMatchObject({
			value: { a: 1 },
			strategy: "extracted",
		});
	});

	it("closes a truncated trailing bracket", () => {
		expect(repairJsonValue('[{"a":1},{"a":2}')).toMatchObject({
			value: [{ a: 1 }, { a: 2 }],
		});
	});

	it("repairs trailing commas, unquoted keys, and single quotes", () => {
		expect(repairJsonValue("{a: 'x', b: 2,}")).toMatchObject({ value: { a: "x", b: 2 }, strategy: "repaired" });
	});

	it("fails cleanly on non-JSON", () => {
		expect(repairJsonValue("just some words").ok).toBe(false);
		expect(repairJsonValue(42).ok).toBe(false);
	});
});

describe("repairJsonStringValue", () => {
	it("returns the parsed value or the original input on failure", () => {
		expect(repairJsonStringValue('{"a":1}')).toEqual({ a: 1 });
		expect(repairJsonStringValue("not json")).toBe("not json");
		expect(repairJsonStringValue({ already: "object" })).toEqual({ already: "object" });
	});
});
