/**
 * Power-aware timeout scaling for the test/verify harnesses (todo §5.AF/§5.Z; user directive 2026-06-28).
 *
 * The dev machine may be switched to **Low Power Mode** (less heat) which can cut LLM throughput by up to ~50% — so a
 * fixed harness timeout that passes at full power can spuriously report INCOMPLETE in low power. This module detects the
 * OS power mode and scales a *base* (normal-power) timeout budget accordingly, so a sweep adapts automatically instead of
 * needing the operator to remember to bump `NKLEIN_VERIFY_TIMEOUT_MS` by hand.
 *
 * The decision logic (parse + multiplier + scale) is pure + exhaustively testable; OS detection is injectable (`run`),
 * so tests never spawn `pmset`. macOS exposes the mode two ways depending on version: the unified `powermode` field
 * (Apple Silicon: `0`=automatic/normal · `1`=low · `2`=high) and/or the older `lowpowermode` flag (`0`/`1`).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PowerMode = "low" | "normal" | "high" | "unknown";

/**
 * Parse a macOS `pmset -g` dump into a {@link PowerMode}. Low wins if either signal reports it; `powermode 2` is high;
 * a recognized non-low signal is normal; anything unrecognized is `unknown` (callers must NOT scale on unknown).
 */
export function parseMacPowerMode(pmsetOutput: string): PowerMode {
	const lowFlag = /lowpowermode\s+(\d+)/i.exec(pmsetOutput);
	if (lowFlag && Number(lowFlag[1]) === 1) {
		return "low";
	}
	// `(?<![a-z])` so we match the standalone `powermode` field, not the `powermode` inside `lowpowermode`.
	const powerMode = /(?<![a-z])powermode\s+(\d+)/i.exec(pmsetOutput);
	if (powerMode) {
		const value = Number(powerMode[1]);
		if (value === 1) {
			return "low";
		}
		if (value === 2) {
			return "high";
		}
		if (value === 0) {
			return "normal";
		}
	}
	if (lowFlag && Number(lowFlag[1]) === 0) {
		return "normal";
	}
	return "unknown";
}

export interface PowerTimeoutOptions {
	/** Multiplier in low power (≈50% throughput → default 2× the budget). */
	lowMultiplier?: number;
	/** Multiplier in high power — default 1 (never SHORTEN a budget; high power is headroom, not a tighter deadline). */
	highMultiplier?: number;
}

/** The timeout multiplier for a power mode. `normal`/`unknown` never scale (1). */
export function powerModeTimeoutMultiplier(mode: PowerMode, options?: PowerTimeoutOptions): number {
	switch (mode) {
		case "low":
			return options?.lowMultiplier ?? 2;
		case "high":
			return options?.highMultiplier ?? 1;
		default:
			return 1;
	}
}

/** Scale a base (normal-power) timeout for a power mode (rounded, ≥1). */
export function scaleTimeoutForPowerMode(baseMs: number, mode: PowerMode, options?: PowerTimeoutOptions): number {
	return Math.max(1, Math.round(baseMs * powerModeTimeoutMultiplier(mode, options)));
}

export interface PowerModeDetectOptions {
	/** Override the platform (tests). Defaults to `process.platform`. */
	platform?: NodeJS.Platform;
	/** Override the `pmset -g` invocation (tests). Defaults to spawning `pmset -g`. */
	run?: () => Promise<string>;
}

/** Detect the OS power mode. Non-darwin (or any failure) → `unknown` (callers won't scale). */
export async function detectSystemPowerMode(options?: PowerModeDetectOptions): Promise<PowerMode> {
	const platform = options?.platform ?? process.platform;
	if (platform !== "darwin") {
		return "unknown";
	}
	try {
		const output = options?.run ? await options.run() : (await execFileAsync("pmset", ["-g"])).stdout;
		return parseMacPowerMode(output);
	} catch {
		return "unknown";
	}
}

export interface PowerAwareTimeout {
	timeoutMs: number;
	baseMs: number;
	mode: PowerMode;
	multiplier: number;
	source: "env_override" | "detected";
}

/**
 * Resolve a power-aware timeout from a base (normal-power) budget. An explicit `NKLEIN_POWER_TIMEOUT_SCALE` env wins
 * (e.g. `2` to force, `1` to disable auto-scaling); otherwise detect the OS power mode and scale (low ≈ ×2). The
 * `envScale`/detect overrides keep it fully testable.
 */
export async function resolvePowerAwareTimeoutMs(
	baseMs: number,
	options?: PowerTimeoutOptions & PowerModeDetectOptions & { envScale?: string | undefined },
): Promise<PowerAwareTimeout> {
	const rawEnv = options && "envScale" in options ? options.envScale : process.env.NKLEIN_POWER_TIMEOUT_SCALE;
	const envScale = rawEnv === undefined ? Number.NaN : Number(rawEnv);
	if (Number.isFinite(envScale) && envScale > 0) {
		return {
			timeoutMs: Math.max(1, Math.round(baseMs * envScale)),
			baseMs,
			mode: "unknown",
			multiplier: envScale,
			source: "env_override",
		};
	}
	const mode = await detectSystemPowerMode(options);
	const multiplier = powerModeTimeoutMultiplier(mode, options);
	return { timeoutMs: scaleTimeoutForPowerMode(baseMs, mode, options), baseMs, mode, multiplier, source: "detected" };
}
