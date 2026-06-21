import type { RuntimeTaskNKleinSettings } from "./api-contract";

export const AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS = {
	timeoutMode: "normal",
	requestTimeoutMs: 30 * 60 * 1000,
	streamTimeoutMs: 6 * 60 * 1000,
	toolTimeoutMs: 10 * 60 * 1000,
	agentTimeoutMs: 30 * 60 * 1000,
	conversationTimeoutMs: 4 * 60 * 60 * 1000,
} as const satisfies RuntimeTaskNKleinSettings;

export function withAutonomousNKleinTimeoutSettings(
	settings?: RuntimeTaskNKleinSettings | null,
): RuntimeTaskNKleinSettings {
	if (settings?.timeoutMode === "unlimited") {
		return { ...settings };
	}
	return {
		...settings,
		timeoutMode: settings?.timeoutMode ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.timeoutMode,
		requestTimeoutMs: settings?.requestTimeoutMs ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.requestTimeoutMs,
		streamTimeoutMs: settings?.streamTimeoutMs ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.streamTimeoutMs,
		toolTimeoutMs: settings?.toolTimeoutMs ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.toolTimeoutMs,
		agentTimeoutMs: settings?.agentTimeoutMs ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.agentTimeoutMs,
		conversationTimeoutMs:
			settings?.conversationTimeoutMs ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.conversationTimeoutMs,
	};
}
