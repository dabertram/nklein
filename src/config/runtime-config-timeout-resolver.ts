import {
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeTimeoutMsValue,
} from "./runtime-config-normalizers";
import type { RuntimeConfigState, RuntimeGlobalConfigFileShape } from "./runtime-config-types";

/** The agent timeout-mode/profile + per-phase timeout-ms fields of the resolved runtime config. */
export type RuntimeTimeoutConfigFields = Pick<
	RuntimeConfigState,
	| "agentTimeoutMode"
	| "agentTimeoutProfile"
	| "requestTimeoutMs"
	| "streamTimeoutMs"
	| "toolTimeoutMs"
	| "agentTimeoutMs"
	| "conversationTimeoutMs"
>;

/**
 * Resolve the agent timeout-mode/profile and the four per-phase timeout-ms fields from a stored
 * global config. Extracted from the toRuntimeConfigState builder (§5.U) as a focused, independently
 * tested sub-resolver.
 */
export function resolveRuntimeTimeoutConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
): RuntimeTimeoutConfigFields {
	return {
		agentTimeoutMode: normalizeAgentTimeoutMode(globalConfig?.agentTimeoutMode),
		agentTimeoutProfile: normalizeAgentTimeoutProfile(globalConfig?.agentTimeoutProfile),
		requestTimeoutMs: normalizeTimeoutMsValue(globalConfig?.requestTimeoutMs),
		streamTimeoutMs: normalizeTimeoutMsValue(globalConfig?.streamTimeoutMs),
		toolTimeoutMs: normalizeTimeoutMsValue(globalConfig?.toolTimeoutMs),
		agentTimeoutMs: normalizeTimeoutMsValue(globalConfig?.agentTimeoutMs),
		conversationTimeoutMs: normalizeTimeoutMsValue(globalConfig?.conversationTimeoutMs),
	};
}
