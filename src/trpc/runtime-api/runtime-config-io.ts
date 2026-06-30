import { TRPCError } from "@trpc/server";
import { type RuntimeConfigState, updateGlobalRuntimeConfig, updateRuntimeConfig } from "../../config/runtime-config";
import type { RuntimeConfigResponse, RuntimeConfigSaveRequest } from "../../core/api-contract";
import { parseRuntimeConfigSaveRequest } from "../../core/api-validation";
import { setNKleinLostHeartbeatPolicy } from "../../nklein-agent/nklein-session-state";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

interface RuntimeConfigIoDeps {
	/** Builds the wire response (provider summary + sandbox status) — kept in the factory closure. */
	buildConfigResponse: (runtimeConfig: RuntimeConfigState) => RuntimeConfigResponse;
	getActiveRuntimeConfig?: () => RuntimeConfigState;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	getActiveWorkspaceId: () => string | null;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
}

/**
 * Resolve the runtime config for a scope (the runtime-api `loadConfig` procedure handler, extracted from
 * the factory): the scoped config when a workspace is given, else the active global config. Applies the
 * lost-heartbeat policy as a side effect. Throws when no config provider is available.
 */
export async function handleLoadConfig(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	deps: RuntimeConfigIoDeps,
): Promise<RuntimeConfigResponse> {
	const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
	if (!workspaceScope && !activeRuntimeConfig) {
		throw new Error("No active runtime config provider is available.");
	}
	let scopedRuntimeConfig: RuntimeConfigState;
	if (workspaceScope) {
		scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
	} else if (activeRuntimeConfig) {
		scopedRuntimeConfig = activeRuntimeConfig;
	} else {
		throw new Error("No active runtime config provider is available.");
	}
	setNKleinLostHeartbeatPolicy(scopedRuntimeConfig.lostHeartbeatPolicy);
	return deps.buildConfigResponse(scopedRuntimeConfig);
}

/**
 * Persist a runtime config change (the runtime-api `saveConfig` procedure handler): per-workspace when a
 * scope is given, else the active global config. Keeps the active config in sync when the saved scope is
 * the active workspace (or global), and reapplies the lost-heartbeat policy.
 */
export async function handleSaveConfig(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: RuntimeConfigSaveRequest,
	deps: RuntimeConfigIoDeps,
): Promise<RuntimeConfigResponse> {
	const parsed = parseRuntimeConfigSaveRequest(input);
	let nextRuntimeConfig: RuntimeConfigState;
	if (workspaceScope) {
		nextRuntimeConfig = await updateRuntimeConfig(workspaceScope.workspacePath, parsed);
	} else {
		const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
		if (!activeRuntimeConfig) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "No active runtime config is available." });
		}
		nextRuntimeConfig = await updateGlobalRuntimeConfig(activeRuntimeConfig, parsed);
	}
	if (workspaceScope && workspaceScope.workspaceId === deps.getActiveWorkspaceId()) {
		deps.setActiveRuntimeConfig(nextRuntimeConfig);
	}
	if (!workspaceScope) {
		deps.setActiveRuntimeConfig(nextRuntimeConfig);
	}
	setNKleinLostHeartbeatPolicy(nextRuntimeConfig.lostHeartbeatPolicy);
	return deps.buildConfigResponse(nextRuntimeConfig);
}
