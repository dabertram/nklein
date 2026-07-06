import { describe, expect, it } from "vitest";
import {
	createRailMessage,
	filterToolsByName,
	formatOutputHeader,
	hasSynthesisText,
	sanitizePathSegment,
} from "../../../src/nklein-agent/nklein-large-file-workflow-helpers";
import type { AgentMessage, AgentToolDefinition } from "../../../src/nklein-agent/sdk-agent-types";

describe("sanitizePathSegment (§5.U extraction)", () => {
	it("replaces unsafe characters with underscores and keeps safe ones", () => {
		expect(sanitizePathSegment("a/b c:d")).toBe("a_b_c_d");
		expect(sanitizePathSegment("keep.this-one_1")).toBe("keep.this-one_1");
	});

	it("falls back to 'session' for an all-unsafe / empty value", () => {
		expect(sanitizePathSegment("")).toBe("session");
		expect(sanitizePathSegment("///")).toBe("___"); // non-empty after replace ⇒ kept
	});
});

describe("filterToolsByName (§5.U extraction)", () => {
	it("keeps only allow-listed tools", () => {
		const tools = [{ name: "read" }, { name: "write" }, { name: "search" }] as AgentToolDefinition[];
		expect(filterToolsByName(tools, new Set(["read", "search"])).map((t) => t.name)).toEqual(["read", "search"]);
		expect(filterToolsByName(tools, new Set())).toEqual([]);
	});
});

describe("hasSynthesisText (§5.U extraction)", () => {
	const message = (content: unknown[]): AgentMessage => ({ content }) as unknown as AgentMessage;

	it("is true when there is non-blank text and no tool-call", () => {
		expect(hasSynthesisText(message([{ type: "text", text: "  hello  " }]))).toBe(true);
	});

	it("is false when a tool-call part is present (short-circuits)", () => {
		expect(hasSynthesisText(message([{ type: "text", text: "hi" }, { type: "tool-call" }]))).toBe(false);
	});

	it("is false when there is only blank/no text", () => {
		expect(hasSynthesisText(message([{ type: "text", text: "   " }]))).toBe(false);
		expect(hasSynthesisText(message([]))).toBe(false);
	});
});

describe("formatOutputHeader (§5.U extraction)", () => {
	it("formats the model-facing section header", () => {
		expect(formatOutputHeader({ kind: "primary", sourcePath: "a.ts", startLine: 1, endLine: 40 })).toBe(
			"### primary a.ts:1-40",
		);
		expect(formatOutputHeader({ kind: "stitch", sourcePath: "b.ts", startLine: 100, endLine: 120 })).toBe(
			"### stitch b.ts:100-120",
		);
	});
});

describe("createRailMessage (§5.U extraction)", () => {
	it("builds a user rail message carrying the text with the rail metadata kind", () => {
		const message = createRailMessage("do the next step");
		expect(message.role).toBe("user");
		expect(message.content).toEqual([{ type: "text", text: "do the next step" }]);
		expect(message.metadata).toEqual({ kind: "kanban_large_file_rail" });
		expect(message.id).toMatch(/^kanban-large-file-rail-/);
	});
});
