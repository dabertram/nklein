import { describe, expect, it } from "vitest";
import {
	formatRepeatedToolCallParkMessage,
	getRepeatedToolCallLimit,
	NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD,
} from "../../../src/nklein-agent/repeated-tool-call-guard";

describe("getRepeatedToolCallLimit", () => {
	it("gives read/command tools a higher park threshold (they legitimately repeat more)", () => {
		expect(getRepeatedToolCallLimit("read_files", 3)).toBe(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD);
		expect(getRepeatedToolCallLimit("run_commands", 3)).toBe(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD);
		expect(getRepeatedToolCallLimit("  READ_FILES  ", 3)).toBe(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD); // case/space-insensitive
	});

	it("never drops below the operator-configured base limit", () => {
		expect(getRepeatedToolCallLimit("read_files", 10)).toBe(10); // base wins when higher than the extra threshold
	});

	it("uses the base limit for ordinary tools", () => {
		expect(getRepeatedToolCallLimit("edit_file", 3)).toBe(3);
		expect(getRepeatedToolCallLimit("decompose_project", 4)).toBe(4);
	});
});

describe("formatRepeatedToolCallParkMessage", () => {
	it("gives empty decompose_project the weak-local-model diagnostic", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "decompose_project",
			count: 3,
			toolInputSummary: null,
		});
		expect(message).toContain("empty arguments");
		expect(message).toContain("more capable model");
		expect(message).toContain("3×");
	});

	it("uses the generic repeated-call message for other tools, echoing count + input summary", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "edit_file",
			count: 5,
			toolInputSummary: "path: src/a.ts",
		});
		expect(message).toContain("5 repeated edit_file tool calls");
		expect(message).toContain("(path: src/a.ts)");
		expect(message).not.toContain("empty arguments");
	});

	it("treats decompose_project WITH arguments as the generic case, not the empty diagnostic", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "decompose_project",
			count: 2,
			toolInputSummary: "slug: my-project",
		});
		expect(message).not.toContain("empty arguments");
		expect(message).toContain("2 repeated decompose_project tool calls");
	});
});
