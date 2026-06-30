import type { RuntimeTaskNKleinSettings } from "./api-contract";
import { detectSystemPowerMode, powerModeTimeoutMultiplier } from "./power-aware-timeout";

export const AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS = {
	timeoutMode: "normal",
	requestTimeoutMs: 30 * 60 * 1000,
	streamTimeoutMs: 6 * 60 * 1000,
	toolTimeoutMs: 10 * 60 * 1000,
	agentTimeoutMs: 30 * 60 * 1000,
	conversationTimeoutMs: 4 * 60 * 60 * 1000,
} as const satisfies RuntimeTaskNKleinSettings;

/**
 * Resolve the OS power-mode multiplier for the autonomous timeout defaults (Low Power ≈ ×2). This mirrors the verify
 * harnesses' power-aware budgets ({@link ./power-aware-timeout}): on a slow machine the runtime's OWN inactivity guards
 * (esp. the stream-inactivity timeout) must not trip before the agent has had a fair chance — otherwise a capable but
 * slow model's long decompose/prefill turn is killed mid-flight (observed: a 27B under Low Power hit the 6-min stream
 * timeout during a `complex_dag` decompose, while the already-power-scaled harness was still patiently waiting). The
 * `NKLEIN_POWER_TIMEOUT_SCALE` env overrides (e.g. `1` to disable, `2` to force); non-darwin / detection failure → 1
 * (no scaling). Detect ONCE per decompose/run at the async boundary, then pass into the board builders (sync + pure).
 */
export async function resolveAutonomousTimeoutPowerMultiplier(options?: { envScale?: string }): Promise<number> {
	const rawEnv = options && "envScale" in options ? options.envScale : process.env.NKLEIN_POWER_TIMEOUT_SCALE;
	const envScale = rawEnv === undefined ? Number.NaN : Number(rawEnv);
	if (Number.isFinite(envScale) && envScale > 0) {
		return envScale;
	}
	return powerModeTimeoutMultiplier(await detectSystemPowerMode());
}

/**
 * Apply the autonomous timeout defaults to a card's NKlein settings, filling any unset timeout field with the
 * autonomous default. `options.powerMultiplier` (≥1; from {@link resolveAutonomousTimeoutPowerMultiplier}) scales the
 * DEFAULTS only — an explicit per-role/user timeout is respected as-is (the user asked for exactly that). An
 * `unlimited` mode is returned untouched. Backward-compatible: no `powerMultiplier` ⇒ ×1 ⇒ the prior values.
 */
export function withAutonomousNKleinTimeoutSettings(
	settings?: RuntimeTaskNKleinSettings | null,
	options?: { powerMultiplier?: number },
): RuntimeTaskNKleinSettings {
	if (settings?.timeoutMode === "unlimited") {
		return { ...settings };
	}
	const multiplier = Math.max(1, options?.powerMultiplier ?? 1);
	const scaledDefault = (base: number): number => Math.max(1, Math.round(base * multiplier));
	return {
		...settings,
		timeoutMode: settings?.timeoutMode ?? AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.timeoutMode,
		requestTimeoutMs:
			settings?.requestTimeoutMs ?? scaledDefault(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.requestTimeoutMs),
		streamTimeoutMs: settings?.streamTimeoutMs ?? scaledDefault(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.streamTimeoutMs),
		toolTimeoutMs: settings?.toolTimeoutMs ?? scaledDefault(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.toolTimeoutMs),
		agentTimeoutMs: settings?.agentTimeoutMs ?? scaledDefault(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.agentTimeoutMs),
		conversationTimeoutMs:
			settings?.conversationTimeoutMs ?? scaledDefault(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.conversationTimeoutMs),
	};
}
