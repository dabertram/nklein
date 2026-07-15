/**
 * F3.19 — power- AND speed-aware liveness budgets. The watchdog's `stalled` verdict fires when a run shows no PROGRESS
 * (no state transition) for `stalledAfterMs` — but a model streaming ONE long answer makes no progress until the turn
 * ends, so a genuinely-working slow model (low tok/s, esp. in low-power mode) on a big task can be FALSELY killed by a
 * fixed threshold. This derives the thresholds from measured throughput + task shape + power mode: `stalledAfterMs` is
 * floored at the expected generation time (expectedOutputTokens ÷ measured tok/s) with headroom, and everything is
 * scaled up in low power. A fast model on a small task keeps the tight base; a slow one on a big task gets room.
 *
 * Pure + deterministic (no clock, no I/O). Composes {@link powerModeTimeoutMultiplier} + {@link RunLivenessThresholds}.
 */

import { type PowerMode, powerModeTimeoutMultiplier } from "./power-aware-timeout.js";
import type { RunLivenessThresholds } from "./run-attention-signals.js";

export interface SpeedAwareLivenessInput {
	/** Measured completion throughput for the running model (from the ledger's tok/s). null/≤0 ⇒ no speed derivation. */
	measuredTokensPerSec: number | null;
	/** Expected output size for this task's turn (the caller maps difficulty → a token estimate). */
	expectedOutputTokens: number;
	/** OS power mode of the host running the model. */
	powerMode: PowerMode;
	/** The normal-power fixed thresholds — the FLOOR (a derived budget never goes below these). */
	base: RunLivenessThresholds;
	/** Headroom over the raw expected generation time (ttft + variance). Default 3×. */
	safetyFactor?: number;
}

/**
 * Derive power- + speed-aware liveness thresholds. `stalledAfterMs` = max(base, expectedGenMs × safety) × powerMult so a
 * still-generating slow model isn't cut off; `idle`/`heartbeatLost` scale by power only (a heartbeat gap is death
 * regardless of speed, but low power stretches every wait). Never SHORTENS below the base (high power is headroom).
 */
export function deriveLivenessThresholds(input: SpeedAwareLivenessInput): RunLivenessThresholds {
	const powerMult = powerModeTimeoutMultiplier(input.powerMode);
	const safety = input.safetyFactor && input.safetyFactor > 0 ? input.safetyFactor : 3;
	const tps = input.measuredTokensPerSec;
	const tokens = Math.max(0, input.expectedOutputTokens);
	const expectedGenMs = typeof tps === "number" && tps > 0 && tokens > 0 ? (tokens / tps) * 1000 : 0;
	const stalledFloor = Math.max(input.base.stalledAfterMs, expectedGenMs * safety);
	return {
		idleAfterMs: Math.round(input.base.idleAfterMs * powerMult),
		stalledAfterMs: Math.round(stalledFloor * powerMult),
		heartbeatLostAfterMs: Math.round(input.base.heartbeatLostAfterMs * powerMult),
	};
}
