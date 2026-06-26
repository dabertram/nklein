import { describe, expect, it } from "vitest";

import { parseMcpSuggestionText } from "@/components/runtime-settings-mcp-parsing";

describe("parseMcpSuggestionText", () => {
	it("parses a single streamableHttp server object", () => {
		const result = parseMcpSuggestionText(
			JSON.stringify({ name: "ctx7", type: "streamableHttp", url: "https://mcp.example.com/mcp" }),
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.server).toMatchObject({
			name: "ctx7",
			type: "streamableHttp",
			url: "https://mcp.example.com/mcp",
			disabled: false,
		});
		expect(result[0]?.label).toBe("ctx7");
	});

	it("defaults the type to streamableHttp and prefers title/label for the display label", () => {
		const result = parseMcpSuggestionText(
			JSON.stringify({ name: "ctx7", title: "Context7", url: "https://mcp.example.com/" }),
		);
		expect(result[0]?.server.type).toBe("streamableHttp");
		expect(result[0]?.label).toBe("Context7");
	});

	it("accepts sse servers", () => {
		const result = parseMcpSuggestionText(
			JSON.stringify([{ name: "s", type: "sse", url: "https://x.example.com/" }]),
		);
		expect(result[0]?.server.type).toBe("sse");
	});

	it("rejects non-https urls, unknown types, and missing/invalid fields", () => {
		expect(parseMcpSuggestionText(JSON.stringify({ name: "x", url: "http://insecure.example.com/" }))).toEqual([]);
		expect(
			parseMcpSuggestionText(JSON.stringify({ name: "x", type: "stdio", url: "https://x.example.com/" })),
		).toEqual([]);
		expect(parseMcpSuggestionText(JSON.stringify({ url: "https://x.example.com/" }))).toEqual([]);
		expect(parseMcpSuggestionText(JSON.stringify({ name: "x", url: "not a url" }))).toEqual([]);
	});

	it("reads servers from { mcpServers } / { servers } wrappers and a top-level array", () => {
		expect(
			parseMcpSuggestionText(JSON.stringify({ mcpServers: [{ name: "a", url: "https://a.example.com/" }] })),
		).toHaveLength(1);
		expect(
			parseMcpSuggestionText(JSON.stringify({ servers: [{ name: "b", url: "https://b.example.com/" }] })),
		).toHaveLength(1);
		expect(parseMcpSuggestionText(JSON.stringify([{ name: "c", url: "https://c.example.com/" }]))).toHaveLength(1);
	});

	it("de-duplicates by case-insensitive server name", () => {
		const result = parseMcpSuggestionText(
			JSON.stringify([
				{ name: "Dup", url: "https://1.example.com/" },
				{ name: "dup", url: "https://2.example.com/" },
			]),
		);
		expect(result).toHaveLength(1);
	});

	it("returns [] for empty or whitespace input", () => {
		expect(parseMcpSuggestionText("")).toEqual([]);
		expect(parseMcpSuggestionText("   ")).toEqual([]);
	});
});
