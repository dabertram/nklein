import type { RuntimeTaskClineSettings } from "./api-contract";

export const AUTONOMOUS_CLINE_TIMEOUT_SETTINGS = {
	timeoutMode: "normal",
	requestTimeoutMs: 30 * 60 * 1000,
	streamTimeoutMs: 6 * 60 * 1000,
	toolTimeoutMs: 10 * 60 * 1000,
	agentTimeoutMs: 30 * 60 * 1000,
	conversationTimeoutMs: 4 * 60 * 60 * 1000,
} as const satisfies RuntimeTaskClineSettings;

export function withAutonomousClineTimeoutSettings(
	settings?: RuntimeTaskClineSettings | null,
): RuntimeTaskClineSettings {
	if (settings?.timeoutMode === "unlimited") {
		return { ...settings };
	}
	return {
		...settings,
		timeoutMode: settings?.timeoutMode ?? AUTONOMOUS_CLINE_TIMEOUT_SETTINGS.timeoutMode,
		requestTimeoutMs: settings?.requestTimeoutMs ?? AUTONOMOUS_CLINE_TIMEOUT_SETTINGS.requestTimeoutMs,
		streamTimeoutMs: settings?.streamTimeoutMs ?? AUTONOMOUS_CLINE_TIMEOUT_SETTINGS.streamTimeoutMs,
		toolTimeoutMs: settings?.toolTimeoutMs ?? AUTONOMOUS_CLINE_TIMEOUT_SETTINGS.toolTimeoutMs,
		agentTimeoutMs: settings?.agentTimeoutMs ?? AUTONOMOUS_CLINE_TIMEOUT_SETTINGS.agentTimeoutMs,
		conversationTimeoutMs: settings?.conversationTimeoutMs ?? AUTONOMOUS_CLINE_TIMEOUT_SETTINGS.conversationTimeoutMs,
	};
}
