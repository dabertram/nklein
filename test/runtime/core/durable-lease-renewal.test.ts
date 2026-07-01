import { describe, expect, it } from "vitest";
import {
	decideLeaseRenewal,
	isLeaseActionFenced,
	type LeaseRenewalPolicy,
	type LeaseRenewalRequest,
	type RenewableLease,
} from "../../../src/core/durable-lease-renewal";

const NOW = 1_000_000;

/** Build a renewable lease with healthy defaults; override any field. */
function lease(overrides: Partial<RenewableLease> = {}): RenewableLease {
	return {
		workerId: "worker-A",
		acquiredAt: NOW,
		expiresAt: NOW + 30_000,
		lastHeartbeatAt: NOW,
		fenceEpoch: 1,
		...overrides,
	};
}

/** Convenience: run the decision with `NOW` and optional overrides. */
function decide(overrides: Partial<LeaseRenewalRequest> = {}) {
	return decideLeaseRenewal({ lease: lease(), now: NOW, ...overrides });
}

describe("decideLeaseRenewal", () => {
	describe("hold — healthy lease", () => {
		it("holds when the holder is alive and the lease is comfortably ahead of its deadline", () => {
			const decision = decide();
			expect(decision.verdict).toBe("hold");
			expect(decision.holderSilent).toBe(false);
			expect(decision.lapsed).toBe(false);
			expect(decision.sinceLastHeartbeatMs).toBe(0);
			expect(decision.untilExpiryMs).toBe(30_000);
		});

		it("does not grant a new expiry or bump the fence on hold", () => {
			const decision = decide();
			expect(decision.nextExpiresAt).toBe(NOW + 30_000);
			expect(decision.nextFenceEpoch).toBe(1);
		});

		it("a foreign requester never steals a HEALTHY lease (steal is only for lapsed/silent holders)", () => {
			const decision = decide({ requesterId: "worker-B" });
			expect(decision.verdict).toBe("hold");
		});
	});

	describe("renew — alive but near expiry", () => {
		it("renews when the holder is alive and the lease is within the renew window", () => {
			// expires in 4s (< the default 5s renewWithinMs), heartbeat is fresh (2s ago).
			const decision = decide({
				lease: lease({ expiresAt: NOW + 4_000, lastHeartbeatAt: NOW - 2_000 }),
			});
			expect(decision.verdict).toBe("renew");
			expect(decision.nextExpiresAt).toBe(NOW + 30_000); // now + default leaseDurationMs
			expect(decision.nextFenceEpoch).toBe(1); // a renew does NOT bump the fence
		});

		it("renews exactly AT the renew-window boundary (untilExpiry === renewWithinMs)", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW + 5_000 }) });
			expect(decision.verdict).toBe("renew");
		});

		it("holds just OUTSIDE the renew window (untilExpiry one ms beyond)", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW + 5_001 }) });
			expect(decision.verdict).toBe("hold");
		});

		it("a near-expiry lease whose holder ALSO went silent expires, not renews (dead beats near-expiry)", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW + 3_000, lastHeartbeatAt: NOW - 60_000 }),
			});
			expect(decision.verdict).toBe("expire");
		});
	});

	describe("expire — dead holder (lapsed or silent), no foreign taker", () => {
		it("expires a fully lapsed lease (now === expiresAt)", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW }) });
			expect(decision.verdict).toBe("expire");
			expect(decision.lapsed).toBe(true);
			expect(decision.untilExpiryMs).toBe(0);
		});

		it("expires a lease whose expiry is in the past", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW - 1 }) });
			expect(decision.verdict).toBe("expire");
			expect(decision.lapsed).toBe(true);
			expect(decision.untilExpiryMs).toBe(-1);
		});

		it("expires a NOT-yet-lapsed lease whose HEARTBEAT went stale past interval + grace (the hung-worker case)", () => {
			// expires 20s from now (not lapsed), but last heartbeat was 21s ago > 15s + 5s grace.
			const decision = decide({
				lease: lease({ expiresAt: NOW + 20_000, lastHeartbeatAt: NOW - 21_000 }),
			});
			expect(decision.verdict).toBe("expire");
			expect(decision.lapsed).toBe(false);
			expect(decision.holderSilent).toBe(true);
			expect(decision.sinceLastHeartbeatMs).toBe(21_000);
		});

		it("does NOT expire a lease exactly AT the silence deadline (interval + grace); stays hold", () => {
			// 20_000ms since heartbeat === 15_000 + 5_000; `holderSilent` is strict `>`, so this is still alive.
			const decision = decide({
				lease: lease({ expiresAt: NOW + 20_000, lastHeartbeatAt: NOW - 20_000 }),
			});
			expect(decision.holderSilent).toBe(false);
			expect(decision.verdict).toBe("hold");
		});

		it("expires ONE ms past the silence deadline", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW + 20_000, lastHeartbeatAt: NOW - 20_001 }),
			});
			expect(decision.holderSilent).toBe(true);
			expect(decision.verdict).toBe("expire");
		});

		it("a requester equal to the current holder does NOT steal its own lapsed lease — it expires", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW - 1 }),
				requesterId: "worker-A", // same as the holder
			});
			expect(decision.verdict).toBe("expire");
		});

		it("does not grant a new expiry or bump the fence on expire", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW - 5_000, fenceEpoch: 7 }) });
			expect(decision.nextExpiresAt).toBe(NOW - 5_000);
			expect(decision.nextFenceEpoch).toBe(7);
		});
	});

	describe("steal — a different live worker takes over a dead lease (fenced)", () => {
		it("steals a lapsed lease for a foreign requester, minting a strictly-higher fence epoch", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW - 1, fenceEpoch: 4 }),
				requesterId: "worker-B",
			});
			expect(decision.verdict).toBe("steal");
			expect(decision.nextFenceEpoch).toBe(5); // strictly greater than the stolen epoch
			expect(decision.nextExpiresAt).toBe(NOW + 30_000);
		});

		it("steals a SILENT-but-not-lapsed lease for a foreign requester", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW + 20_000, lastHeartbeatAt: NOW - 30_000 }),
				requesterId: "worker-B",
			});
			expect(decision.verdict).toBe("steal");
			expect(decision.holderSilent).toBe(true);
			expect(decision.lapsed).toBe(false);
		});

		it("an absent fence epoch on the stolen lease folds to 0, so the stealer gets epoch 1", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW - 1, fenceEpoch: undefined }),
				requesterId: "worker-B",
			});
			expect(decision.verdict).toBe("steal");
			expect(decision.nextFenceEpoch).toBe(1);
		});

		it("an empty-string requesterId is treated as absent (anonymous assessor) → expire, not steal", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW - 1 }), requesterId: "" });
			expect(decision.verdict).toBe("expire");
		});
	});

	describe("never-beaten lease (lastHeartbeatAt absent)", () => {
		it("falls back to acquiredAt for liveness — a just-acquired lease is fresh", () => {
			const decision = decide({
				lease: lease({ acquiredAt: NOW, lastHeartbeatAt: undefined }),
			});
			expect(decision.sinceLastHeartbeatMs).toBe(0);
			expect(decision.verdict).toBe("hold");
		});

		it("an OLD acquire with no heartbeat is presumed silent (never beaten within the window)", () => {
			const decision = decide({
				lease: lease({ acquiredAt: NOW - 60_000, expiresAt: NOW + 20_000, lastHeartbeatAt: null }),
			});
			expect(decision.holderSilent).toBe(true);
			expect(decision.verdict).toBe("expire");
			expect(decision.sinceLastHeartbeatMs).toBe(60_000);
		});
	});

	describe("clock-skew clamping", () => {
		it("clamps a future heartbeat to age 0 (never treats a future beat as silent)", () => {
			const decision = decide({
				lease: lease({ lastHeartbeatAt: NOW + 10_000 }),
			});
			expect(decision.sinceLastHeartbeatMs).toBe(0);
			expect(decision.holderSilent).toBe(false);
		});

		it("reports a negative untilExpiryMs for a past expiry (not clamped — the sign carries meaning)", () => {
			const decision = decide({ lease: lease({ expiresAt: NOW - 250 }) });
			expect(decision.untilExpiryMs).toBe(-250);
		});
	});

	describe("policy overrides + validation", () => {
		it("honours a custom renewWithinMs window", () => {
			const policy: LeaseRenewalPolicy = { renewWithinMs: 10_000 };
			// 8s to expiry: outside the default 5s window (would hold), inside a 10s window (renews).
			const decision = decide({ lease: lease({ expiresAt: NOW + 8_000 }), policy });
			expect(decision.verdict).toBe("renew");
		});

		it("honours a custom heartbeat interval + grace for the silence deadline", () => {
			const policy: LeaseRenewalPolicy = { heartbeatIntervalMs: 1_000, heartbeatGraceMs: 0 };
			// 2s since heartbeat > 1s + 0 grace → silent under the tight policy.
			const decision = decide({
				lease: lease({ expiresAt: NOW + 20_000, lastHeartbeatAt: NOW - 2_000 }),
				policy,
			});
			expect(decision.verdict).toBe("expire");
			expect(decision.holderSilent).toBe(true);
		});

		it("grants the custom leaseDurationMs on renew", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW + 1_000 }),
				policy: { leaseDurationMs: 90_000 },
			});
			expect(decision.verdict).toBe("renew");
			expect(decision.nextExpiresAt).toBe(NOW + 90_000);
		});

		it("falls back to defaults for non-finite / negative policy values", () => {
			const decision = decide({
				lease: lease({ expiresAt: NOW + 4_000 }),
				policy: {
					renewWithinMs: Number.NaN,
					heartbeatIntervalMs: -1,
					heartbeatGraceMs: Number.POSITIVE_INFINITY,
					leaseDurationMs: 0, // a 0-length lease is nonsensical → falls back to the default 30000
				},
			});
			// default 5s window, so a 4s-to-expiry lease still renews with the default duration.
			expect(decision.verdict).toBe("renew");
			expect(decision.nextExpiresAt).toBe(NOW + 30_000);
		});
	});

	describe("determinism + purity", () => {
		it("is deterministic — same inputs yield an identical decision", () => {
			const req: LeaseRenewalRequest = {
				lease: lease({ expiresAt: NOW + 2_000 }),
				now: NOW,
				requesterId: "worker-B",
			};
			expect(decideLeaseRenewal(req)).toEqual(decideLeaseRenewal(req));
		});

		it("does not mutate the input lease", () => {
			const input = lease({ expiresAt: NOW - 1, fenceEpoch: 3 });
			const frozen = Object.freeze({ ...input });
			decideLeaseRenewal({ lease: frozen, now: NOW, requesterId: "worker-B" });
			expect(frozen).toEqual(input);
		});

		it("reads no ambient clock — a stolen lease's nextExpiresAt derives from the INJECTED now", () => {
			const later = NOW + 500_000;
			const decision = decideLeaseRenewal({
				lease: lease({ expiresAt: NOW - 1 }),
				now: later,
				requesterId: "worker-B",
			});
			expect(decision.nextExpiresAt).toBe(later + 30_000);
		});
	});

	describe("reason strings", () => {
		it("names the cause for each verdict", () => {
			expect(decide().reason).toMatch(/healthy/);
			expect(decide({ lease: lease({ expiresAt: NOW + 1_000 }) }).reason).toMatch(/near expiry/);
			expect(decide({ lease: lease({ expiresAt: NOW - 1 }) }).reason).toMatch(/lapsed/);
			expect(decide({ lease: lease({ expiresAt: NOW + 20_000, lastHeartbeatAt: NOW - 30_000 }) }).reason).toMatch(
				/silent/,
			);
			expect(decide({ lease: lease({ expiresAt: NOW - 1 }), requesterId: "worker-B" }).reason).toMatch(/worker-B/);
		});
	});
});

describe("isLeaseActionFenced", () => {
	it("refuses an action carrying a STALE (lower) epoch than the lease's current one (the zombie guard)", () => {
		// A stolen lease is now at epoch 5; an old holder's in-flight action still carries epoch 4.
		expect(isLeaseActionFenced(5, 4)).toBe(true);
	});

	it("admits an action at the current epoch", () => {
		expect(isLeaseActionFenced(5, 5)).toBe(false);
	});

	it("admits an action at a higher epoch (a fresh grant)", () => {
		expect(isLeaseActionFenced(5, 6)).toBe(false);
	});

	it("folds absent epochs to 0 — a caller that never adopted fencing is never fenced out", () => {
		expect(isLeaseActionFenced(undefined, undefined)).toBe(false);
		expect(isLeaseActionFenced(0, 0)).toBe(false);
	});

	it("fences out an action with no epoch (0) when the lease has advanced past it", () => {
		expect(isLeaseActionFenced(2, undefined)).toBe(true);
	});

	it("treats non-finite epochs as 0", () => {
		expect(isLeaseActionFenced(Number.NaN, 3)).toBe(false); // current folds to 0, action 3 ≥ 0
		expect(isLeaseActionFenced(3, Number.NaN)).toBe(true); // action folds to 0 < 3
	});

	it("composes with a steal decision — the minted nextFenceEpoch admits the new holder and fences the old one", () => {
		const decision = decideLeaseRenewal({
			lease: {
				workerId: "worker-A",
				acquiredAt: NOW,
				expiresAt: NOW - 1,
				lastHeartbeatAt: NOW,
				fenceEpoch: 4,
			},
			now: NOW,
			requesterId: "worker-B",
		});
		expect(decision.verdict).toBe("steal");
		// The new holder acts under the minted epoch → admitted; the old holder still at epoch 4 → fenced out.
		expect(isLeaseActionFenced(decision.nextFenceEpoch, decision.nextFenceEpoch)).toBe(false);
		expect(isLeaseActionFenced(decision.nextFenceEpoch, 4)).toBe(true);
	});
});
