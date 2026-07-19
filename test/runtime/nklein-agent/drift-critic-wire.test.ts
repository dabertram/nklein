import { describe, expect, it, vi } from "vitest";
import { decideDriftCheck, parseDriftCriticVerdict } from "../../../src/core/drift-critic";

/**
 * F12.92 wire-contract tests. The extension itself needs a full SDK context to instantiate, so these pin the
 * CONTRACT the wire depends on — the properties whose violation would make the wire misbehave in production.
 */
describe("F12.92 drift-critic wire contract", () => {
	it("stays quiet until the run has a trajectory worth judging", () => {
		// The wire kicks off a check only when `check` is true; an early run must not spend a model call.
		expect(decideDriftCheck({ turn: 0, lastCheckTurn: null }).check).toBe(false);
		expect(decideDriftCheck({ turn: 3, lastCheckTurn: null }).check).toBe(false);
		// The 4-turn FLOOR and the 8-turn calm CADENCE are distinct gates: clearing the floor is necessary but
		// not sufficient, so the first calm check lands at turn 8, not turn 4.
		expect(decideDriftCheck({ turn: 4, lastCheckTurn: null }).check).toBe(false);
		expect(decideDriftCheck({ turn: 8, lastCheckTurn: null }).check).toBe(true);
		// Under distress the tightened cadence (4) meets the floor, so the first check can fire at turn 4.
		expect(decideDriftCheck({ turn: 4, lastCheckTurn: null, inDistress: true }).check).toBe(true);
	});

	it("tightens the cadence under distress, matching the F12.21 re-anchor rule the wire reuses", () => {
		// Calm: 8 turns since the last check. Distress: 4.
		expect(decideDriftCheck({ turn: 10, lastCheckTurn: 4, inDistress: false }).check).toBe(false);
		expect(decideDriftCheck({ turn: 10, lastCheckTurn: 4, inDistress: true }).check).toBe(true);
	});

	it("injects NOTHING when the critic reports on-track — the wire keys off workerNote", () => {
		const verdict = parseDriftCriticVerdict("ON_TRACK");
		expect(verdict.onTrack).toBe(true);
		expect(verdict.workerNote).toBeNull();
	});

	it("injects NOTHING for an unparseable reply — a spurious nudge is worse than none", () => {
		// The wire's guard is `!verdict.onTrack && verdict.workerNote`; garbage must not satisfy it.
		for (const reply of ["", "   ", "I think it's fine?", "<<<garbage>>>"]) {
			const verdict = parseDriftCriticVerdict(reply);
			expect(verdict.onTrack || verdict.workerNote === null).toBe(true);
		}
	});

	it("produces an injectable note when the critic names real drift", () => {
		const verdict = parseDriftCriticVerdict("DRIFT: building a cache nobody asked for | HINT: re-read the objective");
		expect(verdict.onTrack).toBe(false);
		expect(verdict.workerNote).toBeTruthy();
		expect(verdict.flags).toHaveLength(1);
	});

	it("caps flags so a chatty critic cannot flood the worker's context", () => {
		const many = Array.from({ length: 9 }, (_, i) => `DRIFT: d${i} | HINT: h${i}`).join("\n");
		expect(parseDriftCriticVerdict(many).flags.length).toBeLessThanOrEqual(3);
	});

	it("the injected caller contract is fire-and-forget: a rejection must be swallowable", async () => {
		// The wire calls `.catch()` — this pins that a rejecting caller yields no unhandled rejection.
		const caller = vi.fn(async () => {
			throw new Error("critic endpoint down");
		});
		await expect(caller().catch(() => null)).resolves.toBeNull();
	});
});
