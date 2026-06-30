import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import { LEGACY_WORKSPACE_ID_HEADER, WORKSPACE_ID_HEADER } from "../../../src/core/workspace-scope";
import { readWorkspaceIdFromRequest } from "../../../src/server/workspace-id-from-request";

/** Minimal request stub — the parser only reads `.headers`. */
function request(headers: IncomingMessage["headers"]): IncomingMessage {
	return { headers } as IncomingMessage;
}

const url = (search = "") => new URL(`http://localhost/${search}`);

describe("readWorkspaceIdFromRequest", () => {
	it("reads the canonical workspace-id header", () => {
		expect(readWorkspaceIdFromRequest(request({ [WORKSPACE_ID_HEADER]: "ws-1" }), url())).toBe("ws-1");
	});

	it("falls back to the legacy header when the canonical one is absent", () => {
		expect(readWorkspaceIdFromRequest(request({ [LEGACY_WORKSPACE_ID_HEADER]: "ws-legacy" }), url())).toBe(
			"ws-legacy",
		);
	});

	it("prefers the canonical header over the legacy header", () => {
		const req = request({ [WORKSPACE_ID_HEADER]: "ws-new", [LEGACY_WORKSPACE_ID_HEADER]: "ws-old" });
		expect(readWorkspaceIdFromRequest(req, url())).toBe("ws-new");
	});

	it("uses the first value when a header is repeated (array)", () => {
		expect(readWorkspaceIdFromRequest(request({ [WORKSPACE_ID_HEADER]: ["ws-a", "ws-b"] }), url())).toBe("ws-a");
	});

	it("trims header values and skips blank ones in favor of the next candidate", () => {
		const req = request({ [WORKSPACE_ID_HEADER]: "   ", [LEGACY_WORKSPACE_ID_HEADER]: "  ws-trim  " });
		expect(readWorkspaceIdFromRequest(req, url())).toBe("ws-trim");
	});

	it("falls back to the workspaceId query parameter (trimmed)", () => {
		expect(readWorkspaceIdFromRequest(request({}), url("?workspaceId=%20ws-query%20"))).toBe("ws-query");
	});

	it("returns null when no header or query yields a non-empty id", () => {
		expect(readWorkspaceIdFromRequest(request({ [WORKSPACE_ID_HEADER]: "  " }), url("?workspaceId="))).toBeNull();
	});

	it("returns null for a request with no relevant headers or query", () => {
		expect(readWorkspaceIdFromRequest(request({}), url())).toBeNull();
	});
});
