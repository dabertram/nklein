import type { RuntimeConfigState } from "../../config/runtime-config";
import type { TaskRunTimeoutSource } from "../../state/task-run-summary-store";

/**
 * Pure resolution of the effective per-task agent timeout settings, extracted from the oversized `runtime-api.ts`
 * (todo §5.U). Combines the autonomous-profile defaults, the global runtime config, and the per-task/role override
 * (in that precedence) and applies the timeout-mode scale + the local-provider floor. `resolveEffectiveTaskTimeoutSettings`
 * is the single entry point `createRuntimeApi` calls; the rest are private helpers. No I/O.
 */

function getProfileTimeoutDefaults(profile: "cloud" | "local" | "custom"): {
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
} {
	if (profile === "cloud" || profile === "local") {
		return {
			requestTimeoutMs: 60 * 60 * 1000,
			streamTimeoutMs: 24 * 60 * 60 * 1000,
			toolTimeoutMs: 24 * 60 * 60 * 1000,
			agentTimeoutMs: 24 * 60 * 60 * 1000,
			conversationTimeoutMs: 7 * 24 * 60 * 60 * 1000,
		};
	}
	return {
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
	};
}

function scaleTimeoutMs(value: number | null, factor: number): number | null {
	if (value === null) {
		return null;
	}
	return Math.max(0, Math.trunc(value * factor));
}

const MIN_POSITIVE_NKLEIN_TIMEOUT_MS = 60 * 1000;

function enforceLocalNKleinTimeoutFloor(value: number | null): number | null {
	if (value === null || value === 0) {
		return value;
	}
	return Math.max(MIN_POSITIVE_NKLEIN_TIMEOUT_MS, value);
}

/**
 * Provenance of a resolved timeout value, mirroring the precedence in `resolveEffectiveTaskTimeoutSettings`:
 * a per-task/role override wins, then the global runtime config, then the autonomous profile default. Surfaced
 * on terminal run summaries so a timeout-triggered review records *where* the bound that fired came from.
 */
function resolveTimeoutSource(
	taskValue: number | null | undefined,
	globalValue: number | null | undefined,
): TaskRunTimeoutSource {
	if (taskValue !== null && taskValue !== undefined) {
		return "role_override";
	}
	if (globalValue !== null && globalValue !== undefined) {
		return "global_config";
	}
	return "autonomous_default";
}

export function resolveEffectiveTaskTimeoutSettings(input: {
	runtimeConfig: RuntimeConfigState;
	taskSettings?: {
		timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		requestTimeoutMs?: number | null;
		streamTimeoutMs?: number | null;
		toolTimeoutMs?: number | null;
		agentTimeoutMs?: number | null;
		conversationTimeoutMs?: number | null;
	};
}): {
	timeoutMode: "normal" | "long" | "extended" | "unlimited";
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	timeoutProfile: "cloud" | "local" | "custom";
	streamTimeoutSource: TaskRunTimeoutSource;
	toolTimeoutSource: TaskRunTimeoutSource;
	conversationTimeoutSource: TaskRunTimeoutSource;
} {
	const timeoutProfile = input.runtimeConfig.agentTimeoutProfile;
	const timeoutMode = input.taskSettings?.timeoutMode ?? input.runtimeConfig.agentTimeoutMode;
	const profileDefaults = getProfileTimeoutDefaults(timeoutProfile);
	const requestTimeoutMs =
		input.taskSettings?.requestTimeoutMs ?? input.runtimeConfig.requestTimeoutMs ?? profileDefaults.requestTimeoutMs;
	const streamTimeoutMs =
		input.taskSettings?.streamTimeoutMs ?? input.runtimeConfig.streamTimeoutMs ?? profileDefaults.streamTimeoutMs;
	const toolTimeoutMs =
		input.taskSettings?.toolTimeoutMs ?? input.runtimeConfig.toolTimeoutMs ?? profileDefaults.toolTimeoutMs;
	const agentTimeoutMs =
		input.taskSettings?.agentTimeoutMs ?? input.runtimeConfig.agentTimeoutMs ?? profileDefaults.agentTimeoutMs;
	const conversationTimeoutMs =
		input.taskSettings?.conversationTimeoutMs ??
		input.runtimeConfig.conversationTimeoutMs ??
		profileDefaults.conversationTimeoutMs;
	const streamTimeoutSource = resolveTimeoutSource(
		input.taskSettings?.streamTimeoutMs,
		input.runtimeConfig.streamTimeoutMs,
	);
	const toolTimeoutSource = resolveTimeoutSource(input.taskSettings?.toolTimeoutMs, input.runtimeConfig.toolTimeoutMs);
	const conversationTimeoutSource = resolveTimeoutSource(
		input.taskSettings?.conversationTimeoutMs,
		input.runtimeConfig.conversationTimeoutMs,
	);

	if (timeoutMode === "unlimited") {
		return {
			timeoutMode,
			timeoutProfile,
			requestTimeoutMs: null,
			streamTimeoutMs: null,
			toolTimeoutMs: null,
			agentTimeoutMs: null,
			conversationTimeoutMs: null,
			streamTimeoutSource,
			toolTimeoutSource,
			conversationTimeoutSource,
		};
	}

	const scale = timeoutMode === "extended" ? 6 : timeoutMode === "long" ? 3 : 1;
	return {
		timeoutMode,
		timeoutProfile,
		requestTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(requestTimeoutMs, scale)),
		streamTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(streamTimeoutMs, scale)),
		toolTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(toolTimeoutMs, scale)),
		agentTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(agentTimeoutMs, scale)),
		conversationTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(conversationTimeoutMs, scale)),
		streamTimeoutSource,
		toolTimeoutSource,
		conversationTimeoutSource,
	};
}
