import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJsonLineWithSchema } from "../../../src/core/parse-json-line";

const schema = z.object({ id: z.string(), n: z.number() });

describe("parseJsonLineWithSchema", () => {
	it("returns the parsed value for a valid JSON line", () => {
		expect(parseJsonLineWithSchema('{"id":"a","n":1}', schema)).toEqual({ id: "a", n: 1 });
	});

	it("returns null for valid JSON that fails the schema", () => {
		expect(parseJsonLineWithSchema('{"id":"a","n":"nope"}', schema)).toBeNull();
		expect(parseJsonLineWithSchema('{"id":"a"}', schema)).toBeNull();
	});

	it("returns null for malformed JSON (the parse throw is caught)", () => {
		expect(parseJsonLineWithSchema("not json", schema)).toBeNull();
		expect(parseJsonLineWithSchema("", schema)).toBeNull();
		expect(parseJsonLineWithSchema("{ unterminated", schema)).toBeNull();
	});
});
