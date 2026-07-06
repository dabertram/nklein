import { describe, expect, it } from "vitest";
import {
	buildMcpOauthCallbackUrl,
	createOauthClientMetadata,
	MCP_OAUTH_CALLBACK_PATH,
	MCP_OAUTH_CALLBACK_REQUEST_ID_PARAM,
	matchesMcpOauthCallbackPath,
	readMcpOauthCallbackRequestId,
} from "../../../src/nklein-agent/nklein-mcp-oauth-callback";

describe("buildMcpOauthCallbackUrl (§5.U extraction)", () => {
	it("builds an absolute callback URL carrying the request id", () => {
		const url = new URL(buildMcpOauthCallbackUrl("req-123"));
		expect(url.pathname).toBe(MCP_OAUTH_CALLBACK_PATH);
		expect(url.searchParams.get(MCP_OAUTH_CALLBACK_REQUEST_ID_PARAM)).toBe("req-123");
		expect(url.protocol).toMatch(/^https?:$/);
	});

	it("url-encodes a request id with special characters", () => {
		const url = new URL(buildMcpOauthCallbackUrl("a b/c&d"));
		expect(url.searchParams.get(MCP_OAUTH_CALLBACK_REQUEST_ID_PARAM)).toBe("a b/c&d");
	});
});

describe("matchesMcpOauthCallbackPath (§5.U extraction)", () => {
	it("is true only for the callback path", () => {
		expect(matchesMcpOauthCallbackPath(new URL(`http://x${MCP_OAUTH_CALLBACK_PATH}?requestId=1`))).toBe(true);
		expect(matchesMcpOauthCallbackPath(new URL("http://x/other"))).toBe(false);
	});
});

describe("readMcpOauthCallbackRequestId (§5.U extraction)", () => {
	it("returns the trimmed request id, or null when absent / blank", () => {
		expect(readMcpOauthCallbackRequestId(new URL("http://x/cb?requestId=%20req-9%20"))).toBe("req-9");
		expect(readMcpOauthCallbackRequestId(new URL("http://x/cb?requestId=%20%20"))).toBeNull();
		expect(readMcpOauthCallbackRequestId(new URL("http://x/cb"))).toBeNull();
	});
});

describe("createOauthClientMetadata (§5.U extraction)", () => {
	it("describes a public client with the given redirect and auth-code + refresh grants", () => {
		expect(createOauthClientMetadata("http://x/cb?requestId=1")).toEqual({
			client_name: "!Klein",
			redirect_uris: ["http://x/cb?requestId=1"],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		});
	});
});
