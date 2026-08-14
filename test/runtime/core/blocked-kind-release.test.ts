import { describe, expect, it } from "vitest";
import { decideBlockedKindRelease } from "../../../src/core/blocked-kind-release";

describe("decideBlockedKindRelease (David 2026-08-12: enforce + auto-clear)", () => {
	const environment = (over: Partial<Parameters<typeof decideBlockedKindRelease>[1]> = {}) => ({
		currentFleetFingerprint: null,
		anyModelLoaded: false,
		sandboxAvailable: false,
		...over,
	});

	it("releases a reshard-stranded card when the fleet fingerprint CHANGED since the stamp", () => {
		const decision = decideBlockedKindRelease(
			{ blockedKind: "needs_decomposition", blockedFleetFingerprint: "fleet-a" },
			environment({ currentFleetFingerprint: "fleet-b" }),
		);
		expect(decision.release).toBe(true);
	});

	it("holds when the fleet is unchanged, and when the current fingerprint is UNKNOWN", () => {
		expect(
			decideBlockedKindRelease(
				{ blockedKind: "needs_decomposition", blockedFleetFingerprint: "fleet-a" },
				environment({ currentFleetFingerprint: "fleet-a" }),
			).release,
		).toBe(false);
		expect(
			decideBlockedKindRelease(
				{ blockedKind: "needs_decomposition", blockedFleetFingerprint: "fleet-a" },
				environment({ currentFleetFingerprint: null }),
			).release,
		).toBe(false);
	});

	it("never fleet-releases an unstamped needs_decomposition card — a decomposition is its clearer", () => {
		const decision = decideBlockedKindRelease(
			{ blockedKind: "needs_decomposition" },
			environment({ currentFleetFingerprint: "fleet-b" }),
		);
		expect(decision.release).toBe(false);
		expect(decision.reason).toContain("decomposition");
	});

	it("releases local_model_required exactly when a model is loaded", () => {
		expect(
			decideBlockedKindRelease({ blockedKind: "local_model_required" }, environment({ anyModelLoaded: true }))
				.release,
		).toBe(true);
		expect(
			decideBlockedKindRelease({ blockedKind: "local_model_required" }, environment({ anyModelLoaded: false }))
				.release,
		).toBe(false);
	});

	it("releases agent_sandbox_unavailable exactly when the sandbox is back", () => {
		expect(
			decideBlockedKindRelease({ blockedKind: "agent_sandbox_unavailable" }, environment({ sandboxAvailable: true }))
				.release,
		).toBe(true);
		expect(
			decideBlockedKindRelease(
				{ blockedKind: "agent_sandbox_unavailable" },
				environment({ sandboxAvailable: false }),
			).release,
		).toBe(false);
	});
});
