import { z } from "zod";

export const SANDBOX_MCP_SERVER_IDS = [
	"sequential-thinking",
	"codebase-memory",
	"lsp-symbols",
	"basic-memory",
] as const;
export const sandboxMcpServerIdSchema = z.enum(SANDBOX_MCP_SERVER_IDS);
export type SandboxMcpServerId = z.infer<typeof sandboxMcpServerIdSchema>;

export const sandboxMcpServerControlsSchema = z
	.object({
		"sequential-thinking": z.boolean(),
		"codebase-memory": z.boolean(),
		"lsp-symbols": z.boolean(),
		"basic-memory": z.boolean(),
	})
	.strict();
export type SandboxMcpServerControls = z.infer<typeof sandboxMcpServerControlsSchema>;

export const sandboxMcpServerOverridesSchema = sandboxMcpServerControlsSchema.partial().strict();
export type SandboxMcpServerOverrides = z.infer<typeof sandboxMcpServerOverridesSchema>;

export interface ResolvedSandboxMcpControls {
	sandboxMcpServersEnabledOverride: boolean | null;
	effectiveSandboxMcpServersEnabled: boolean;
	sandboxMcpServerOverrides: SandboxMcpServerOverrides | null;
	effectiveSandboxMcpServerControls: SandboxMcpServerControls;
}

export function normalizeSandboxMcpServerOverrides(value: unknown): SandboxMcpServerOverrides | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const parsed = sandboxMcpServerOverridesSchema.safeParse(value);
	if (!parsed.success) return null;
	return Object.keys(parsed.data).length > 0 ? parsed.data : null;
}

export function areSandboxMcpServerOverridesEqual(
	left: SandboxMcpServerOverrides | null,
	right: SandboxMcpServerOverrides | null,
): boolean {
	return SANDBOX_MCP_SERVER_IDS.every((id) => left?.[id] === right?.[id]);
}

/** Resolve project overrides over the global master switch and the curated server defaults. */
export function resolveSandboxMcpControls(input: {
	sandboxMcpServersEnabled: boolean;
	sandboxMcpServersEnabledOverride?: boolean | null;
	basicMemoryEnabled: boolean;
	sandboxMcpServerOverrides?: SandboxMcpServerOverrides | null;
}): ResolvedSandboxMcpControls {
	const sandboxMcpServersEnabledOverride =
		input.sandboxMcpServersEnabledOverride === true || input.sandboxMcpServersEnabledOverride === false
			? input.sandboxMcpServersEnabledOverride
			: null;
	const sandboxMcpServerOverrides = normalizeSandboxMcpServerOverrides(input.sandboxMcpServerOverrides);
	const globalControls: SandboxMcpServerControls = {
		"sequential-thinking": true,
		"codebase-memory": true,
		"lsp-symbols": true,
		"basic-memory": input.basicMemoryEnabled === true,
	};
	return {
		sandboxMcpServersEnabledOverride,
		effectiveSandboxMcpServersEnabled: sandboxMcpServersEnabledOverride ?? input.sandboxMcpServersEnabled === true,
		sandboxMcpServerOverrides,
		effectiveSandboxMcpServerControls: { ...globalControls, ...(sandboxMcpServerOverrides ?? {}) },
	};
}

/** Apply the resolved per-server controls after availability/model/memory gates, never before those safety gates. */
export function filterSandboxMcpServersByControl<TServer extends { id: string }>(
	servers: readonly TServer[],
	controls: SandboxMcpServerControls,
): TServer[] {
	return servers.filter((server) => {
		const id = sandboxMcpServerIdSchema.safeParse(server.id);
		return id.success && controls[id.data];
	});
}
