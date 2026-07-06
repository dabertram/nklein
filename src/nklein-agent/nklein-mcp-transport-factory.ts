import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RuntimeNKleinMcpServer } from "../core/api-contract";
import type { SdkMcpServerRegistration } from "./sdk-provider-boundary";

/**
 * §5.U — the MCP transport/registration construction extracted from `nklein-mcp-runtime-service`: map a configured
 * server to an SDK registration, build the concrete client transport for its type (stdio / sse / streamable-http), and
 * classify whether a transport can carry OAuth. Pure construction — no connect/IO — so it's independently testable.
 */

export const MCP_LOCAL_EXECUTION_DISABLED_MESSAGE = "MCP local execution is disabled under strict isolation.";

export type AuthCapableTransport = SSEClientTransport | StreamableHTTPClientTransport;
export type SdkTransport = StdioClientTransport | AuthCapableTransport;

/** Map a runtime MCP server config onto the SDK's registration shape (stdio carries command/args/cwd/env; else url/headers). */
export function toMcpRegistration(server: RuntimeNKleinMcpServer): SdkMcpServerRegistration {
	if (server.type === "stdio") {
		return {
			name: server.name,
			disabled: server.disabled,
			transport: {
				type: "stdio",
				command: server.command,
				args: server.args,
				cwd: server.cwd,
				env: server.env,
			},
		};
	}
	return {
		name: server.name,
		disabled: server.disabled,
		transport: {
			type: server.type,
			url: server.url,
			headers: server.headers,
		},
	};
}

/** The warning surfaced when a stdio (local-execution) MCP server is skipped under strict isolation. */
export function formatLocalMcpExecutionDisabledWarning(serverName: string): string {
	return `${MCP_LOCAL_EXECUTION_DISABLED_MESSAGE} Skipped stdio MCP server "${serverName}".`;
}

/** Build the concrete SDK client transport for a server; sse/http transports are wired with the optional OAuth provider. */
export function createTransport(input: {
	server: RuntimeNKleinMcpServer;
	oauthProvider?: OAuthClientProvider;
}): SdkTransport {
	if (input.server.type === "stdio") {
		return new StdioClientTransport({
			command: input.server.command,
			...(input.server.args ? { args: input.server.args } : {}),
			...(input.server.cwd ? { cwd: input.server.cwd } : {}),
			...(input.server.env ? { env: input.server.env } : {}),
			stderr: "ignore",
		});
	}

	if (input.server.type === "sse") {
		return new SSEClientTransport(new URL(input.server.url), {
			authProvider: input.oauthProvider,
			requestInit: input.server.headers
				? {
						headers: input.server.headers,
					}
				: undefined,
		});
	}

	return new StreamableHTTPClientTransport(new URL(input.server.url), {
		authProvider: input.oauthProvider,
		requestInit: input.server.headers
			? {
					headers: input.server.headers,
				}
			: undefined,
	});
}

/** True when the transport is an OAuth-capable (sse / streamable-http) transport, narrowing its type. */
export function isAuthCapableTransport(transport: SdkTransport): transport is AuthCapableTransport {
	return transport instanceof SSEClientTransport || transport instanceof StreamableHTTPClientTransport;
}
