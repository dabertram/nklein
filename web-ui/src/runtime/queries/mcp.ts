// Browser-side query helpers: NKlein MCP server settings, auth statuses, and per-server OAuth.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeNKleinMcpAuthStatusResponse,
	RuntimeNKleinMcpOAuthResponse,
	RuntimeNKleinMcpServer,
	RuntimeNKleinMcpSettingsResponse,
} from "@/runtime/types";

export async function fetchNKleinMcpSettings(workspaceId: string | null): Promise<RuntimeNKleinMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinMcpSettings.query();
}

export async function fetchNKleinMcpAuthStatuses(
	workspaceId: string | null,
): Promise<RuntimeNKleinMcpAuthStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinMcpAuthStatuses.query();
}

export async function saveNKleinMcpSettings(
	workspaceId: string | null,
	input: {
		servers: RuntimeNKleinMcpServer[];
	},
): Promise<RuntimeNKleinMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinMcpSettings.mutate(input);
}

export async function runNKleinMcpServerOAuth(
	workspaceId: string | null,
	input: {
		serverName: string;
	},
): Promise<RuntimeNKleinMcpOAuthResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runNKleinMcpServerOAuth.mutate(input);
}
