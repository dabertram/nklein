import { decideMcpServerMemoryFit } from "./mcp-server-memory-fit";
import { decideMcpServerModelFitById } from "./mcp-server-model-fit";
import { SANDBOX_MCP_SERVERS } from "./sandbox-mcp-catalog";
import {
	areSandboxMcpServerOverridesEqual,
	resolveSandboxMcpControls,
	type SandboxMcpServerControls,
	type SandboxMcpServerId,
	type SandboxMcpServerOverrides,
	sandboxMcpServerIdSchema,
} from "./sandbox-mcp-controls";

export { areSandboxMcpServerOverridesEqual };

/** One operator-facing projection of every gate that decides whether a curated server reaches a new tool bundle. */
export interface SandboxMcpServerSettingsStatus {
	id: SandboxMcpServerId;
	label: string;
	available: boolean;
	availabilityReason: string;
	memoryBudgetMb: number;
	globalEnabled: boolean;
	projectOverride: boolean | null;
	effectiveEnabled: boolean;
	modelFit: { offer: boolean; reason: string };
	memoryFit: { offer: boolean; reason: string };
	active: boolean;
	activationReason: string;
}

export interface SandboxMcpSettingsPreview {
	modelId: string | null;
	globalMasterEnabled: boolean;
	projectMasterOverride: boolean | null;
	effectiveMasterEnabled: boolean;
	servers: readonly SandboxMcpServerSettingsStatus[];
}

export interface BuildSandboxMcpSettingsPreviewInput {
	modelId?: string | null;
	containerMemoryLimitMb?: number;
	sandboxImageAvailable?: boolean | null;
	sandboxMcpServersEnabled: boolean;
	sandboxMcpServersEnabledOverride?: boolean | null;
	basicMemoryEnabled: boolean;
	sandboxMcpServerOverrides?: SandboxMcpServerOverrides | null;
}

function activationReason(input: {
	masterEnabled: boolean;
	available: boolean;
	controlEnabled: boolean;
	modelFit: { offer: boolean; reason: string };
	memoryFit: { offer: boolean; reason: string };
}): string {
	if (!input.masterEnabled) return "Withheld by the effective curated-MCP master switch.";
	if (!input.available) return "Unavailable: the server binary is not present in the sandbox image.";
	if (!input.controlEnabled) return "Withheld by the effective per-server switch.";
	if (!input.modelFit.offer) return `Withheld by model fit: ${input.modelFit.reason}`;
	if (!input.memoryFit.offer) return `Withheld by memory fit: ${input.memoryFit.reason}`;
	return "Active for new sessions using this model and container size.";
}

/**
 * Build the Settings preview from the same catalog and pure gates used by runtime tool-bundle construction. Keeping
 * this projection in core prevents the UI from inventing a second, drifting interpretation of "active".
 */
export function buildSandboxMcpSettingsPreview(input: BuildSandboxMcpSettingsPreviewInput): SandboxMcpSettingsPreview {
	const modelId = input.modelId?.trim() || null;
	const global = resolveSandboxMcpControls({
		sandboxMcpServersEnabled: input.sandboxMcpServersEnabled,
		basicMemoryEnabled: input.basicMemoryEnabled,
	});
	const resolved = resolveSandboxMcpControls(input);
	const servers = SANDBOX_MCP_SERVERS.map((server): SandboxMcpServerSettingsStatus => {
		const id = sandboxMcpServerIdSchema.parse(server.id);
		const available = server.available && input.sandboxImageAvailable !== false;
		const availabilityReason = !server.available
			? "binary is not included in the configured sandbox image"
			: input.sandboxImageAvailable === false
				? "sandbox image is unavailable on this host"
				: input.sandboxImageAvailable === null
					? "binary is catalogued as baked in; sandbox image availability is still being checked"
					: "binary is baked into the available sandbox image";
		const modelFit = modelId
			? decideMcpServerModelFitById(server.fit, modelId)
			: { offer: false, reason: "no model selected — fit cannot be evaluated" };
		const memoryFit = decideMcpServerMemoryFit({
			serverId: id,
			memoryBudgetMb: server.memoryBudgetMb,
			containerMemoryLimitMb: input.containerMemoryLimitMb,
		});
		const effectiveEnabled = resolved.effectiveSandboxMcpServerControls[id];
		const active =
			resolved.effectiveSandboxMcpServersEnabled &&
			available &&
			effectiveEnabled &&
			modelFit.offer &&
			memoryFit.offer;
		return {
			id,
			label: server.label,
			available,
			availabilityReason,
			memoryBudgetMb: server.memoryBudgetMb,
			globalEnabled: global.effectiveSandboxMcpServerControls[id],
			projectOverride: resolved.sandboxMcpServerOverrides?.[id] ?? null,
			effectiveEnabled,
			modelFit,
			memoryFit,
			active,
			activationReason: activationReason({
				masterEnabled: resolved.effectiveSandboxMcpServersEnabled,
				available,
				controlEnabled: effectiveEnabled,
				modelFit,
				memoryFit,
			}),
		};
	});

	return {
		modelId,
		globalMasterEnabled: input.sandboxMcpServersEnabled,
		projectMasterOverride: resolved.sandboxMcpServersEnabledOverride,
		effectiveMasterEnabled: resolved.effectiveSandboxMcpServersEnabled,
		servers,
	};
}

/** Global per-server defaults used when an operator chooses "inherit" in the project controls. */
export function buildGlobalSandboxMcpServerControls(basicMemoryEnabled: boolean): SandboxMcpServerControls {
	return resolveSandboxMcpControls({ sandboxMcpServersEnabled: true, basicMemoryEnabled })
		.effectiveSandboxMcpServerControls;
}
