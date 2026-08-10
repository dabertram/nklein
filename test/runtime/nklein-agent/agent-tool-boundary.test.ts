import { describe, expect, it } from "vitest";
import { relaxAgentToolSchemas } from "../../../src/nklein-agent/agent-tool-boundary";
import type { AgentTool } from "../../../src/nklein-agent/sdk-agent-types";

function tool(name: string, inputSchema: Record<string, unknown>): AgentTool {
	return { name, description: name, inputSchema, execute: async () => "ok" };
}

// The session-wide permissive boundary (live P23.5 campaign): SDK pre-validation answered truncated or
// slightly-off calls with multi-KB Zod dumps across decompose_project, add_task, resolve_result and 25×
// write_file. Local tools get relaxed schemas so the handlers' compact errors govern; MCP tools keep theirs.
describe("relaxAgentToolSchemas", () => {
	const typed = {
		type: "object",
		properties: {
			path: { type: "string", description: "where" },
			content: { type: "string", description: "what" },
		},
		required: ["path", "content"],
		additionalProperties: false,
	};

	it("relaxes local tool schemas so nothing at depth can pre-reject, keeping descriptions", () => {
		const [relaxed] = relaxAgentToolSchemas([tool("write_file", typed)]);
		const schema = relaxed?.inputSchema as { type?: unknown; required?: unknown; properties: unknown };
		expect(schema.type).toBe("object");
		expect(schema.required).toBeUndefined();
		const nested = JSON.stringify(schema.properties);
		expect(nested).not.toContain('"type"');
		expect(nested).toContain("where");
	});

	it("leaves MCP-registered tools untouched", () => {
		const [kept] = relaxAgentToolSchemas([tool("mcp_search", typed)], {
			skipToolNames: new Set(["mcp_search"]),
		});
		expect(kept?.inputSchema).toEqual(typed);
	});

	it("is idempotent and preserves execute identity", async () => {
		const original = tool("write_file", typed);
		const once = relaxAgentToolSchemas([original]);
		const twice = relaxAgentToolSchemas(once);
		expect(twice[0]?.inputSchema).toEqual(once[0]?.inputSchema);
		expect(await twice[0]?.execute({}, undefined as never)).toBe("ok");
	});
});
