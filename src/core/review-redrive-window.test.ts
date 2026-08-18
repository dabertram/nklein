import { describe, expect, it } from "vitest";
import { decideRedriveWindow, MAX_ABSORBED_RECLAIMS, type PendingRedriveObservation } from "./review-redrive-window";

const FP_EMPTY = "fp-empty";
const FP_REAL = "fp-real-work";

function rerouteObservation(overrides: Partial<PendingRedriveObservation> = {}): PendingRedriveObservation {
	// Mirrors bed pair-3b: round 1 bounced qwen3.8's empty patch at 16:54:44 and rerouted to qwen3.6-35b;
	// the restart completed at 16:56:30, and the old session re-claimed the same empty artifact at 16:55:02.
	return {
		fingerprint: FP_EMPTY,
		bouncedSessionStartedAt: 1_787_063_516_000,
		bouncedModelId: "qwen3.8-27b-mlx",
		rerouteTargetModelId: "qwen/qwen3.6-35b-a3b",
		absorbedCount: 0,
		...overrides,
	};
}

describe("decideRedriveWindow", () => {
	it("absorbs the pair-3b re-claim: same session, same fingerprint, reroute pending", () => {
		const decision = decideRedriveWindow({
			observation: rerouteObservation(),
			incomingFingerprint: FP_EMPTY,
			incomingSessionStartedAt: 1_787_063_516_000,
			incomingModelId: "qwen3.8-27b-mlx",
		});
		expect(decision).toEqual({ absorb: true, reason: "same_session_reclaim" });
	});

	it("absorbs a bounced-model re-claim even when the session identity is unavailable", () => {
		const decision = decideRedriveWindow({
			observation: rerouteObservation({ bouncedSessionStartedAt: null }),
			incomingFingerprint: FP_EMPTY,
			incomingSessionStartedAt: null,
			incomingModelId: "qwen3.8-27b-mlx",
		});
		expect(decision).toEqual({ absorb: true, reason: "pre_reroute_model_reclaim" });
	});

	it("judges the re-driven worker's handoff even when its work is byte-identical (park stays reachable)", () => {
		const decision = decideRedriveWindow({
			observation: rerouteObservation(),
			incomingFingerprint: FP_EMPTY,
			incomingSessionStartedAt: 1_787_063_790_000, // fresh session after the reroute restart
			incomingModelId: "qwen/qwen3.6-35b-a3b",
		});
		expect(decision).toEqual({ absorb: false, reason: "redriven_worker" });
	});

	it("judges a changed fingerprint immediately (the real artifact is never absorbed)", () => {
		const decision = decideRedriveWindow({
			observation: rerouteObservation(),
			incomingFingerprint: FP_REAL,
			incomingSessionStartedAt: 1_787_063_516_000,
			incomingModelId: "qwen3.8-27b-mlx",
		});
		expect(decision).toEqual({ absorb: false, reason: "fingerprint_changed" });
	});

	it("stands down after the absorb cap so a wedged re-drive degrades to the normal ladder", () => {
		const decision = decideRedriveWindow({
			observation: rerouteObservation({ absorbedCount: MAX_ABSORBED_RECLAIMS }),
			incomingFingerprint: FP_EMPTY,
			incomingSessionStartedAt: 1_787_063_516_000,
			incomingModelId: "qwen3.8-27b-mlx",
		});
		expect(decision).toEqual({ absorb: false, reason: "absorb_cap_reached" });
	});

	it("does nothing without an observation (plain bounces keep the existing ladder)", () => {
		const decision = decideRedriveWindow({
			observation: null,
			incomingFingerprint: FP_EMPTY,
			incomingSessionStartedAt: 1_787_063_516_000,
			incomingModelId: "qwen3.8-27b-mlx",
		});
		expect(decision).toEqual({ absorb: false, reason: "no_observation" });
	});

	it("same-model escalation absorbs only via session identity, never via the model discriminator", () => {
		// F13 single-model rig: reroute target === bounced model. A handoff on that model proves nothing;
		// only an unchanged session start identifies the pre-re-drive worker.
		const observation = rerouteObservation({ rerouteTargetModelId: "qwen3.8-27b-mlx" });
		expect(
			decideRedriveWindow({
				observation,
				incomingFingerprint: FP_EMPTY,
				incomingSessionStartedAt: 1_787_063_516_000,
				incomingModelId: "qwen3.8-27b-mlx",
			}),
		).toEqual({ absorb: true, reason: "same_session_reclaim" });
		expect(
			decideRedriveWindow({
				observation,
				incomingFingerprint: FP_EMPTY,
				incomingSessionStartedAt: 1_787_063_999_000,
				incomingModelId: "qwen3.8-27b-mlx",
			}),
		).toEqual({ absorb: false, reason: "redriven_worker" });
	});
});
