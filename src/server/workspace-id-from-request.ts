import type { IncomingMessage } from "node:http";

import { LEGACY_WORKSPACE_ID_HEADER, WORKSPACE_ID_HEADER } from "../core/workspace-scope";

/**
 * Resolve the requested workspace id from an HTTP request, extracted from runtime-server. Pure.
 *
 * Precedence: the canonical header, then the legacy header (first value if the header is repeated),
 * then the `workspaceId` query parameter. Each candidate is trimmed and skipped when blank; returns
 * null when none yields a non-empty id.
 */
export function readWorkspaceIdFromRequest(request: IncomingMessage, requestUrl: URL): string | null {
	for (const headerName of [WORKSPACE_ID_HEADER, LEGACY_WORKSPACE_ID_HEADER]) {
		const headerValue = request.headers[headerName];
		const headerWorkspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
		if (typeof headerWorkspaceId === "string") {
			const normalized = headerWorkspaceId.trim();
			if (normalized) {
				return normalized;
			}
		}
	}
	const queryWorkspaceId = requestUrl.searchParams.get("workspaceId");
	if (typeof queryWorkspaceId === "string") {
		const normalized = queryWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}
