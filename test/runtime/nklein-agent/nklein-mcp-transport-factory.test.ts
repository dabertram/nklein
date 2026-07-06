import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import type { RuntimeNKleinMcpServer } from "../../../src/core/api-contract";
import {
	createTransport,
	formatLocalMcpExecutionDisabledWarning,
	isAuthCapableTransport,
	MCP_LOCAL_EXECUTION_DISABLED_MESSAGE,
	toMcpRegistration,
} from "../../../src/nklein-agent/nklein-mcp-transport-factory";

const stdioServer: RuntimeNKleinMcpServer = {
	name: "local",
	disabled: false,
	type: "stdio",
	command: "my-cmd",
	args: ["--x"],
	cwd: "/repo",
	env: { A: "1" },
};
const sseServer: RuntimeNKleinMcpServer = {
	name: "remote-sse",
	disabled: true,
	type: "sse",
	url: "https://example.test/sse",
	headers: { Authorization: "Bearer x" },
};
const httpServer: RuntimeNKleinMcpServer = {
	name: "remote-http",
	disabled: false,
	type: "streamableHttp",
	url: "https://example.test/mcp",
};

describe("toMcpRegistration (§5.U extraction)", () => {
	it("maps a stdio server to a stdio registration (command/args/cwd/env)", () => {
		expect(toMcpRegistration(stdioServer)).toEqual({
			name: "local",
			disabled: false,
			transport: { type: "stdio", command: "my-cmd", args: ["--x"], cwd: "/repo", env: { A: "1" } },
		});
	});

	it("maps a non-stdio server to a url/headers registration, preserving the type", () => {
		expect(toMcpRegistration(sseServer)).toEqual({
			name: "remote-sse",
			disabled: true,
			transport: { type: "sse", url: "https://example.test/sse", headers: { Authorization: "Bearer x" } },
		});
		expect(toMcpRegistration(httpServer).transport).toMatchObject({ type: "streamableHttp", url: httpServer.url });
	});
});

describe("formatLocalMcpExecutionDisabledWarning (§5.U extraction)", () => {
	it("names the skipped server and carries the disabled message", () => {
		const warning = formatLocalMcpExecutionDisabledWarning("local");
		expect(warning).toContain(MCP_LOCAL_EXECUTION_DISABLED_MESSAGE);
		expect(warning).toContain('"local"');
	});
});

describe("createTransport (§5.U extraction)", () => {
	it("builds a StdioClientTransport for a stdio server", () => {
		expect(createTransport({ server: stdioServer })).toBeInstanceOf(StdioClientTransport);
	});

	it("builds an SSEClientTransport for an sse server", () => {
		expect(createTransport({ server: sseServer })).toBeInstanceOf(SSEClientTransport);
	});

	it("builds a StreamableHTTPClientTransport for a streamableHttp server", () => {
		expect(createTransport({ server: httpServer })).toBeInstanceOf(StreamableHTTPClientTransport);
	});
});

describe("isAuthCapableTransport (§5.U extraction)", () => {
	it("is true for sse/http transports and false for stdio", () => {
		expect(isAuthCapableTransport(createTransport({ server: sseServer }))).toBe(true);
		expect(isAuthCapableTransport(createTransport({ server: httpServer }))).toBe(true);
		expect(isAuthCapableTransport(createTransport({ server: stdioServer }))).toBe(false);
	});
});
