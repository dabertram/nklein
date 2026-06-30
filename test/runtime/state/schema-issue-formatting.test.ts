import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formatSchemaIssuePath, formatSchemaIssues } from "../../../src/state/schema-issue-formatting";

describe("formatSchemaIssuePath", () => {
	it("renders the root, string segments, and numeric (array-index) segments", () => {
		expect(formatSchemaIssuePath([])).toBe("root");
		expect(formatSchemaIssuePath(["name"])).toBe("name");
		expect(formatSchemaIssuePath(["board", "columns", 0, "id"])).toBe("board.columns.[0].id");
		expect(formatSchemaIssuePath([0])).toBe("[0]");
	});
});

describe("formatSchemaIssues", () => {
	it("formats each Zod issue as `path: message`, joined by `; `", () => {
		const schema = z.object({ name: z.string(), count: z.number() });
		const result = schema.safeParse({ name: 123, count: "nope" });
		expect(result.success).toBe(false);
		if (!result.success) {
			const formatted = formatSchemaIssues(result.error);
			expect(formatted).toContain("name:");
			expect(formatted).toContain("count:");
			expect(formatted).toContain("; ");
		}
	});

	it("uses 'root' for a top-level (whole-value) issue", () => {
		const result = z.string().safeParse(42);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatSchemaIssues(result.error)).toMatch(/^root: /);
		}
	});
});
