import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type CollectorInput,
	collectDrainedState,
	parseNightlyTeardownReport,
} from "../../src/core/nightly-drain-collector";
import { evaluatePack, type InvariantPack } from "../../src/core/nightly-invariant-pack";

const T0 = 1_000_000;

function input(overrides: Partial<CollectorInput> = {}): CollectorInput {
	return {
		drainStartedAt: T0,
		subscriptions: [
			{ signal: "acceptance_evidence", registeredAt: T0 - 10 },
			{ signal: "review_verdict", registeredAt: T0 - 10 },
			{ signal: "stall_guard", registeredAt: T0 - 10 },
		],
		events: [
			{ signal: "acceptance_evidence", emittedAt: T0 + 5 },
			{ signal: "review_verdict", emittedAt: T0 + 9 },
		],
		terminalCards: [{ cardId: "card-1", lane: "done" }],
		unmatchedAimockRequests: 0,
		teardown: { orphanSessions: 0, orphanWorktrees: 0, orphanLeases: 0 },
		...overrides,
	};
}

describe("collectDrainedState", () => {
	it("parses only measured non-negative integer teardown receipts", () => {
		expect(parseNightlyTeardownReport('{"orphanSessions":1,"orphanWorktrees":2,"orphanLeases":3}')).toEqual({
			orphanSessions: 1,
			orphanWorktrees: 2,
			orphanLeases: 3,
		});
		for (const raw of [
			"not-json",
			"null",
			'{"orphanSessions":-1,"orphanWorktrees":0,"orphanLeases":0}',
			'{"orphanSessions":0.5,"orphanWorktrees":0,"orphanLeases":0}',
			'{"orphanSessions":0,"orphanWorktrees":0}',
		]) {
			expect(() => parseNightlyTeardownReport(raw)).toThrow();
		}
	});

	it("derives watchedSignals from SUBSCRIPTIONS, not from what fired", () => {
		const { state } = collectDrainedState(input());
		expect([...state.watchedSignals].sort()).toEqual(["acceptance_evidence", "review_verdict", "stall_guard"]);
		// stall_guard was watched and stayed quiet — that is a real assertion, not an absence of one.
		expect(state.firedSignals.has("stall_guard")).toBe(false);
	});

	it("excludes a subscription registered AFTER the drain started", () => {
		// A listener that arrived late did not watch the whole drain; counting it reports presence for a window we
		// were absent from.
		const result = collectDrainedState(
			input({
				subscriptions: [
					{ signal: "acceptance_evidence", registeredAt: T0 - 10 },
					{ signal: "taint_hold", registeredAt: T0 + 50 },
				],
			}),
		);
		expect(result.state.watchedSignals.has("taint_hold")).toBe(false);
		expect(result.lateSubscriptions).toEqual(["taint_hold"]);
		expect(result.summary).toContain("AFTER the drain started");
	});

	it("names signals that fired with nothing watching — a coverage gap, not an error", () => {
		const result = collectDrainedState(
			input({ events: [{ signal: "thrash_guard", emittedAt: T0 + 1 }], subscriptions: [] }),
		);
		expect(result.firedButUnwatched).toEqual(["thrash_guard"]);
		expect(result.summary).toContain("coverage gap");
	});

	it("carries orphan counts and unmatched requests through unchanged", () => {
		const { state } = collectDrainedState(
			input({
				unmatchedAimockRequests: 3,
				teardown: { orphanSessions: 1, orphanWorktrees: 2, orphanLeases: 0 },
			}),
		);
		expect(state.unmatchedAimockRequests).toBe(3);
		expect(state.orphanSessions).toBe(1);
		expect(state.orphanWorktrees).toBe(2);
	});

	it("handles an empty drain without inventing evidence", () => {
		const { state } = collectDrainedState(input({ subscriptions: [], events: [], terminalCards: [] }));
		expect(state.watchedSignals.size).toBe(0);
		expect(state.firedSignals.size).toBe(0);
	});
});

describe("collector + pack together", () => {
	const PACK: InvariantPack = {
		id: "core",
		expectedTerminalLanes: ["done"],
		mustFire: ["acceptance_evidence", "review_verdict", "taint_hold"],
		mustStayQuiet: ["stall_guard"],
	};

	it("yields INDETERMINATE for a signal nothing subscribed to — the whole point of N5's third status", () => {
		// taint_hold is in the pack but has no subscription. The honest answer is "we could not tell", and the
		// collector must not manufacture a pass by claiming it watched.
		const { state } = collectDrainedState(input());
		const result = evaluatePack(PACK, state);
		expect(result.passed).toBe(false);
		expect(result.indeterminate.some((c) => c.name === "must_fire:taint_hold")).toBe(true);
		// And critically: NOT reported as violated. "Never fired" and "never watched" are different claims.
		expect(result.violated.some((c) => c.name === "must_fire:taint_hold")).toBe(false);
	});

	it("passes once every pack signal is genuinely subscribed and behaves", () => {
		const { state } = collectDrainedState(
			input({
				subscriptions: [
					{ signal: "acceptance_evidence", registeredAt: T0 - 10 },
					{ signal: "review_verdict", registeredAt: T0 - 10 },
					{ signal: "taint_hold", registeredAt: T0 - 10 },
					{ signal: "stall_guard", registeredAt: T0 - 10 },
				],
				events: [
					{ signal: "acceptance_evidence", emittedAt: T0 + 1 },
					{ signal: "review_verdict", emittedAt: T0 + 2 },
					{ signal: "taint_hold", emittedAt: T0 + 3 },
				],
			}),
		);
		expect(evaluatePack(PACK, state).passed).toBe(true);
	});
});

describe("structural guard", () => {
	it("the collector never receives a pack — the false-pass line cannot be written here", () => {
		// N5b's real risk is `watchedSignals = new Set([...pack.mustFire, ...pack.mustStayQuiet])`, which would turn
		// every `indeterminate` into a false pass without touching N5 or failing any of its tests. The defence is
		// structural rather than behavioural: this module has no access to a pack, so the line is unwritable.
		// This test pins that absence, because a later "convenience" parameter would silently reopen the hole.
		const source = readFileSync(new URL("../../src/core/nightly-drain-collector.ts", import.meta.url), "utf8");
		const code = source.slice(source.indexOf("export interface SignalSubscription"));
		expect(code).not.toMatch(/InvariantPack/);
		expect(code).not.toMatch(/mustFire|mustStayQuiet/);
	});
});
