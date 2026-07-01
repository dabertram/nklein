import { describe, expect, it } from "vitest";
import { parseNKleinMcpSettingsSaveRequest } from "../../../src/core/api-validation";

const stdio = (over: Record<string, unknown> = {}) => ({
	name: "s1",
	disabled: false,
	type: "stdio" as const,
	command: "run",
	...over,
});

describe("parseNKleinMcpSettingsSaveRequest — server normalization + dup detection", () => {
	it("rejects duplicate server names case-insensitively", () => {
		expect(() =>
			parseNKleinMcpSettingsSaveRequest({ servers: [stdio({ name: "srv" }), stdio({ name: "SRV" })] }),
		).toThrow(/duplicated/i);
	});

	it("allows distinct server names", () => {
		const req = parseNKleinMcpSettingsSaveRequest({ servers: [stdio({ name: "a" }), stdio({ name: "b" })] });
		expect(req.servers.map((s) => s.name)).toEqual(["a", "b"]);
	});

	it("trims the name + command and filters empty args on a stdio server", () => {
		const req = parseNKleinMcpSettingsSaveRequest({
			servers: [stdio({ name: "  s1  ", command: "  run  ", args: ["a", "  ", "b", ""] })],
		});
		const server = req.servers[0];
		expect(server.name).toBe("s1");
		expect(server).toMatchObject({ type: "stdio", command: "run", args: ["a", "b"] });
	});

	it("rejects a stdio server with a whitespace-only command", () => {
		expect(() => parseNKleinMcpSettingsSaveRequest({ servers: [stdio({ command: "   " })] })).toThrow(
			/requires a command/i,
		);
	});

	it("rejects a server with an empty name", () => {
		expect(() => parseNKleinMcpSettingsSaveRequest({ servers: [stdio({ name: "   " })] })).toThrow(
			/name cannot be empty/i,
		);
	});

	it("trims the url + filters empty-value headers on an http server", () => {
		const req = parseNKleinMcpSettingsSaveRequest({
			servers: [
				{
					name: "h",
					disabled: false,
					type: "sse",
					url: "https://example.com/mcp",
					headers: { " Auth ": " token ", Empty: "  " },
				},
			],
		});
		const server = req.servers[0];
		expect(server).toMatchObject({ type: "sse", url: "https://example.com/mcp", headers: { Auth: "token" } });
		// The empty-value header was dropped.
		expect(server.type === "sse" && server.headers && "Empty" in server.headers).toBe(false);
	});

	it("omits absent optional args entirely (no empty array)", () => {
		const req = parseNKleinMcpSettingsSaveRequest({ servers: [stdio()] });
		expect(req.servers[0]).not.toHaveProperty("args");
	});
});
