import { z } from "zod";
import { runtimeNKleinMcpServerAuthStatusSchema } from "./stream-events-api-contract.js";

// NKlein MCP contract domain: the MCP server config (stdio / sse / streamableHttp discriminated union),
// settings response + save, auth-status response, and OAuth request/response. Split out of api-contract.ts
// (§5.X #2). Imports z + the MCP server auth-status from stream-events — never the barrel.

const runtimeNKleinMcpServerBaseSchema = z.object({
	name: z.string(),
	disabled: z.boolean(),
});

export const runtimeNKleinMcpServerSchema = z.discriminatedUnion("type", [
	runtimeNKleinMcpServerBaseSchema.extend({
		type: z.literal("stdio"),
		command: z.string(),
		args: z.array(z.string()).optional(),
		cwd: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
	runtimeNKleinMcpServerBaseSchema.extend({
		type: z.literal("sse"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
	runtimeNKleinMcpServerBaseSchema.extend({
		type: z.literal("streamableHttp"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
]);
export type RuntimeNKleinMcpServer = z.infer<typeof runtimeNKleinMcpServerSchema>;

export const runtimeNKleinMcpSettingsResponseSchema = z.object({
	path: z.string(),
	servers: z.array(runtimeNKleinMcpServerSchema),
});
export type RuntimeNKleinMcpSettingsResponse = z.infer<typeof runtimeNKleinMcpSettingsResponseSchema>;

export const runtimeNKleinMcpSettingsSaveRequestSchema = z.object({
	servers: z.array(runtimeNKleinMcpServerSchema),
});
export type RuntimeNKleinMcpSettingsSaveRequest = z.infer<typeof runtimeNKleinMcpSettingsSaveRequestSchema>;

export const runtimeNKleinMcpSettingsSaveResponseSchema = runtimeNKleinMcpSettingsResponseSchema;
export type RuntimeNKleinMcpSettingsSaveResponse = z.infer<typeof runtimeNKleinMcpSettingsSaveResponseSchema>;

export const runtimeNKleinMcpAuthStatusResponseSchema = z.object({
	statuses: z.array(runtimeNKleinMcpServerAuthStatusSchema),
});
export type RuntimeNKleinMcpAuthStatusResponse = z.infer<typeof runtimeNKleinMcpAuthStatusResponseSchema>;

export const runtimeNKleinMcpOAuthRequestSchema = z.object({
	serverName: z.string(),
});
export type RuntimeNKleinMcpOAuthRequest = z.infer<typeof runtimeNKleinMcpOAuthRequestSchema>;

export const runtimeNKleinMcpOAuthResponseSchema = z.object({
	serverName: z.string(),
	authorized: z.literal(true),
	message: z.string(),
});
export type RuntimeNKleinMcpOAuthResponse = z.infer<typeof runtimeNKleinMcpOAuthResponseSchema>;
