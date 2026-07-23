import { describe, expect, it } from "vitest";
import { preselectMcpServers } from "../../../src/core/mcp-server-relevance-gate";

const SERVERS = [
	{ id: "thinking", name: "Sequential Thinking", description: "plan reason decompose architecture" },
	{ id: "graph", name: "Code Graph", description: "repository code symbol reference caller localization" },
	{ id: "memory", name: "Basic Memory", description: "memory notes history decisions recall" },
];

describe("MCP server relevance pre-pick", () => {
	it("selects described matching servers and withholds nonmatches before registration", () => {
		const result = preselectMcpServers({ servers: SERVERS, taskText: "Find callers of the repository symbol" });

		expect(result.arbitrary).toBe(false);
		expect(result.selected.map((server) => server.id)).toEqual(["graph"]);
		expect(result.withheld.map((server) => server.id)).toEqual(["thinking", "memory"]);
	});

	it("retains legacy servers without relevance metadata alongside a real match", () => {
		const result = preselectMcpServers({
			servers: [...SERVERS, { id: "legacy", name: "Private integration" }],
			taskText: "Recall the prior architecture decision",
		});

		expect(result.selected.map((server) => server.id)).toEqual(["thinking", "memory", "legacy"]);
		expect(result.withheld.map((server) => server.id)).toEqual(["graph"]);
		expect(result.reason).toContain("1 legacy metadata fail-open");
	});

	it("abstains instead of inventing a selection when nothing matches", () => {
		const result = preselectMcpServers({ servers: SERVERS, taskText: "Translate the invoice to French" });

		expect(result.arbitrary).toBe(true);
		expect(result.selected).toEqual(SERVERS);
		expect(result.withheld).toEqual([]);
	});

	it("abstains on empty task text and handles an empty catalog", () => {
		expect(preselectMcpServers({ servers: SERVERS, taskText: "" })).toMatchObject({
			arbitrary: true,
			selected: SERVERS,
		});
		expect(preselectMcpServers({ servers: [], taskText: "code" })).toMatchObject({
			arbitrary: false,
			selected: [],
			withheld: [],
		});
	});
});
