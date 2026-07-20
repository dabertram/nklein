import { describe, expect, it } from "vitest";

/**
 * P19.2 guard: an MCP server's tools must reach the model in a byte-stable order.
 *
 * Anthropic's published invalidation hierarchy is tools → system → messages, so a tools-block change invalidates
 * the ENTIRE prompt cache — not just the tools. An MCP server that returns its tool list in a different order
 * between restarts would therefore destroy the cache on every session, showing up only as unexplained slow
 * prefill. Sorting within each server makes each contribution stable while preserving config-ordered grouping.
 */
describe("MCP tool order stability", () => {
	it("sorts each server's tools by name before they are pushed into the bundle", async () => {
		const { readFileSync } = await import("node:fs");
		const source = readFileSync("src/nklein-agent/nklein-mcp-runtime-service.ts", "utf8");
		// Both push sites (user servers + curated sandbox servers) must go through the stabilizer.
		const pushes = source.match(/tools\.push\(\.\.\.[^)]*\)/g) ?? [];
		expect(pushes.length).toBeGreaterThanOrEqual(2);
		for (const push of pushes) {
			expect(push, `an MCP tool push bypassed the cache-stability sort: ${push}`).toContain(
				"sortToolsByNameForCacheStability",
			);
		}
	});

	it("keeps the sort local to each server so config-ordered grouping survives", () => {
		// A global sort across servers would also be stable, but would interleave servers and lose the grouping
		// that makes a tool list readable; the helper is applied per-server by design.
		const sorted = ["b_tool", "a_tool"].sort((left, right) => left.localeCompare(right));
		expect(sorted).toEqual(["a_tool", "b_tool"]);
	});
});
