import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

/**
 * P17.3 — the MCP protocol-generation TRIPWIRE. The MCP `2026-07-28` revision is the largest since launch and is
 * explicitly BREAKING: it removes the `initialize`/`initialized` handshake (SEP-2575), eliminates
 * `Mcp-Session-Id` / protocol-level sessions entirely (SEP-2567), and restructures server→client requests
 * (SEP-2260/2322) away from the SSE model. !Klein builds against the stable `2025-11-25` generation, and every
 * protocol-facing construction goes through ONE seam (`nklein-mcp-transport-factory.ts`), so the migration is a
 * contained, deliberate change — never a side effect of a dependency bump.
 *
 * If this test fails after an SDK update, the update adopted a NEW protocol generation: do the P17.3 migration
 * deliberately (session/handshake assumptions, the transport factory, and the sandbox MCP servers together), do
 * not just refresh the constants below. The 12-month deprecation policy on `2025-11-25` protects us; chasing an
 * RC does not.
 */
describe("MCP protocol generation pin (P17.3)", () => {
	it("the SDK's latest protocol is the stable 2025-11-25 generation", () => {
		expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
	});

	it("no post-revision (2026+) protocol version has been adopted by the pinned SDK", () => {
		for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
			expect(version < "2026-01-01", `SDK supports post-revision protocol ${version} — see P17.3`).toBe(true);
		}
	});
});
