import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint";

/**
 * §5.U — the MCP OAuth callback-URL protocol + client metadata extracted from `nklein-mcp-runtime-service`: the callback
 * path + requestId param, the outgoing callback URL builder, the two pure reads a callback handler needs (is this our
 * callback path? what's the requestId?), and the OAuth client registration metadata. Pure — no callback registry / IO —
 * so the URL protocol is independently testable.
 */

/** The loopback path !Klein listens on for an MCP OAuth authorization-code callback. */
export const MCP_OAUTH_CALLBACK_PATH = "/kanban-mcp/mcp-oauth-callback";

/** The query param carrying the per-authorization request id on the callback URL. */
export const MCP_OAUTH_CALLBACK_REQUEST_ID_PARAM = "requestId";

/** Build the absolute callback URL (runtime origin + callback path) carrying the request id. */
export function buildMcpOauthCallbackUrl(requestId: string): string {
	const callbackUrl = new URL(buildKanbanRuntimeUrl(MCP_OAUTH_CALLBACK_PATH));
	callbackUrl.searchParams.set(MCP_OAUTH_CALLBACK_REQUEST_ID_PARAM, requestId);
	return callbackUrl.toString();
}

/** True when a request URL is the MCP OAuth callback path (so a non-match can be ignored, not error). */
export function matchesMcpOauthCallbackPath(url: URL): boolean {
	return url.pathname === MCP_OAUTH_CALLBACK_PATH;
}

/** The trimmed request id from a callback URL, or null when absent / blank. */
export function readMcpOauthCallbackRequestId(url: URL): string | null {
	return url.searchParams.get(MCP_OAUTH_CALLBACK_REQUEST_ID_PARAM)?.trim() || null;
}

/** The OAuth dynamic-client-registration metadata !Klein presents for an MCP server (public client, auth-code + refresh). */
export function createOauthClientMetadata(redirectUrl: string): OAuthClientMetadata {
	return {
		client_name: "!Klein",
		redirect_uris: [redirectUrl],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
	};
}
