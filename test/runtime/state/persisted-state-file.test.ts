import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parsePersistedStateFile } from "../../../src/state/persisted-state-file";

const schema = z.object({ count: z.number() });
const fallback = { count: 0 };

describe("parsePersistedStateFile", () => {
	it("returns the default value when the file was absent (raw === null)", () => {
		expect(parsePersistedStateFile("/x/state.json", "state", null, schema, fallback)).toBe(fallback);
	});

	it("returns the validated data for well-formed content", () => {
		expect(parsePersistedStateFile("/x/state.json", "state", { count: 7 }, schema, fallback)).toEqual({
			count: 7,
		});
	});

	it("throws a fix-or-remove error naming the file, the path, and the schema issues", () => {
		try {
			parsePersistedStateFile("/x/state.json", "state", { count: "nope" }, schema, fallback);
			expect.unreachable("expected a validation error");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain("Invalid state file at /x/state.json");
			expect(message).toContain("Fix or remove the file");
			expect(message).toContain("count"); // the offending path is surfaced
		}
	});

	it("does not treat a falsy-but-present value as absent", () => {
		// `0` is valid content, not the null sentinel — it must be parsed, not replaced by the default.
		const numberSchema = z.number();
		expect(parsePersistedStateFile("/x/n.json", "n", 0, numberSchema, 42)).toBe(0);
	});
});
