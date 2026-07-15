import { describe, expect, it } from "vitest";
import { doesNKleinToolInvalidateRepoMap } from "../../../src/nklein-agent/nklein-context-focus-extension";

type AfterToolContext = Parameters<typeof doesNKleinToolInvalidateRepoMap>[0];

function ctx(toolName: string, isError = false): AfterToolContext {
	return { toolCall: { toolName }, result: { isError } } as unknown as AfterToolContext;
}

describe("doesNKleinToolInvalidateRepoMap (§5.N repo-map cache)", () => {
	it("invalidates on a successful mutating tool (write/edit/exec)", () => {
		expect(doesNKleinToolInvalidateRepoMap(ctx("write_file"))).toBe(true);
		expect(doesNKleinToolInvalidateRepoMap(ctx("replace_in_file"))).toBe(true);
		expect(doesNKleinToolInvalidateRepoMap(ctx("execute_command"))).toBe(true);
	});

	it("does NOT invalidate on a read-only tool", () => {
		expect(doesNKleinToolInvalidateRepoMap(ctx("read_files"))).toBe(false);
		expect(doesNKleinToolInvalidateRepoMap(ctx("list_files"))).toBe(false);
	});

	it("does NOT invalidate when the mutating tool errored (no change actually landed)", () => {
		expect(doesNKleinToolInvalidateRepoMap(ctx("write_file", true))).toBe(false);
	});

	it("matches case-insensitively and trims the tool name", () => {
		expect(doesNKleinToolInvalidateRepoMap(ctx("  Write_File  "))).toBe(true);
	});
});
