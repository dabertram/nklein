import { beforeEach, describe, expect, it } from "vitest";
import {
	advanceFleetPoolPresence,
	commitFleetPoolSweep,
	FLEET_POOL_LOSS_MISSES,
	type FleetPoolMember,
	type FleetPoolPresenceState,
	fleetPoolLastSweptAtMs,
	fleetPoolPresenceKey,
	listFleetPoolLosses,
	resetFleetPoolPresenceForTests,
} from "../../../src/core/fleet-pool-presence";

/**
 * P0.POOLLOSS (live 2026-09-03): a crashed pool model disappeared silently and the operator learned by asking.
 * The sweep diffs the configured role pools against each endpoint's loaded set and declares a loss only after two
 * consecutive misses; an empty or failed probe is uncertainty, never evidence.
 */
const ENDPOINT = "http://192.168.68.101:1234/v1";
const DIRK = fleetPoolPresenceKey("dirk", ENDPOINT);
const worker = (modelId: string, role = "worker"): FleetPoolMember => ({
	role,
	primary: true,
	modelId,
	endpoint: ENDPOINT,
});
const listing = (...ids: string[]) => [{ endpoint: ENDPOINT, loadedModelIds: ids }];
const empty: FleetPoolPresenceState = new Map();

describe("advanceFleetPoolPresence", () => {
	it("declares a loss only after the miss gate, carrying the last time the model was seen", () => {
		const seen = advanceFleetPoolPresence({
			previous: empty,
			members: [worker("dirk")],
			listings: listing("dirk"),
			nowMs: 1_000,
		});
		expect(seen.losses).toEqual([]);
		expect(seen.state.get(DIRK)?.state).toBe("present");
		const miss1 = advanceFleetPoolPresence({
			previous: seen.state,
			members: [worker("dirk")],
			listings: listing(),
			nowMs: 2_000,
		});
		expect(miss1.losses).toEqual([]); // one miss is a transient omission or a reload
		expect(miss1.state.get(DIRK)).toMatchObject({ state: "absent", consecutiveMisses: 1, absentSinceMs: 2_000 });
		const miss2 = advanceFleetPoolPresence({
			previous: miss1.state,
			members: [worker("dirk")],
			listings: listing(),
			nowMs: 3_000,
		});
		expect(miss2.losses).toEqual([
			{
				modelId: "dirk",
				endpoint: ENDPOINT,
				roles: ["worker"],
				lastSeenAtMs: 1_000,
				absentSinceMs: 2_000,
				declaredAtMs: 3_000,
			},
		]);
		expect(FLEET_POOL_LOSS_MISSES).toBe(2);
		// A third miss does not re-declare.
		const miss3 = advanceFleetPoolPresence({
			previous: miss2.state,
			members: [worker("dirk")],
			listings: listing(),
			nowMs: 4_000,
		});
		expect(miss3.losses).toEqual([]);
		expect(miss3.state.get(DIRK)?.lossDeclaredAtMs).toBe(3_000);
	});

	it("declares recovery on the first listing that has the model back, with how long it was gone", () => {
		let state = empty;
		for (const nowMs of [1_000, 2_000]) {
			state = advanceFleetPoolPresence({
				previous: state,
				members: [worker("dirk")],
				listings: listing(),
				nowMs,
			}).state;
		}
		const back = advanceFleetPoolPresence({
			previous: state,
			members: [worker("dirk")],
			listings: listing("dirk"),
			nowMs: 9_000,
		});
		expect(back.recoveries).toEqual([
			{ modelId: "dirk", endpoint: ENDPOINT, roles: ["worker"], lostForMs: 8_000, recoveredAtMs: 9_000 },
		]);
		expect(back.state.get(DIRK)).toMatchObject({ state: "present", lossDeclaredAtMs: null, consecutiveMisses: 0 });
		// A present model that was never lost records no recovery.
		expect(
			advanceFleetPoolPresence({
				previous: back.state,
				members: [worker("dirk")],
				listings: listing("dirk"),
				nowMs: 10_000,
			}).recoveries,
		).toEqual([]);
	});

	it("treats a failed or empty probe as uncertainty — no miss counted, a declared loss stays declared", () => {
		const seen = advanceFleetPoolPresence({
			previous: empty,
			members: [worker("dirk")],
			listings: listing("dirk"),
			nowMs: 1_000,
		});
		const unreachable = advanceFleetPoolPresence({
			previous: seen.state,
			members: [worker("dirk")],
			listings: [{ endpoint: ENDPOINT, loadedModelIds: null }],
			nowMs: 2_000,
		});
		expect(unreachable.losses).toEqual([]);
		expect(unreachable.state.get(DIRK)).toMatchObject({
			state: "present",
			consecutiveMisses: 0,
			lastSeenAtMs: 1_000,
		});
		// No listing for the endpoint at all is the same uncertainty.
		const noListing = advanceFleetPoolPresence({
			previous: seen.state,
			members: [worker("dirk")],
			listings: [],
			nowMs: 2_000,
		});
		expect(noListing.state.get(DIRK)?.consecutiveMisses).toBe(0);
		// Declared loss, then the endpoint goes dark: still declared (and not recovered).
		let lost = empty;
		for (const nowMs of [1_000, 2_000]) {
			lost = advanceFleetPoolPresence({
				previous: lost,
				members: [worker("dirk")],
				listings: listing(),
				nowMs,
			}).state;
		}
		const dark = advanceFleetPoolPresence({
			previous: lost,
			members: [worker("dirk")],
			listings: [{ endpoint: ENDPOINT, loadedModelIds: null }],
			nowMs: 3_000,
		});
		expect(dark.recoveries).toEqual([]);
		expect(dark.state.get(DIRK)?.lossDeclaredAtMs).toBe(2_000);
	});

	it("merges the roles of one (model, endpoint) and drops members the operator un-configured", () => {
		const members = [
			worker("dirk", "worker"),
			worker("dirk", "reviewer"),
			{ role: "architect", primary: false, modelId: "big", endpoint: `${ENDPOINT}/` },
		];
		const first = advanceFleetPoolPresence({ previous: empty, members, listings: listing("dirk"), nowMs: 1_000 });
		expect(first.state.get(DIRK)?.roles).toEqual(["worker", "reviewer"]);
		// The trailing slash normalizes onto the same endpoint key.
		expect(first.state.get(fleetPoolPresenceKey("big", ENDPOINT))?.state).toBe("absent");
		const removed = advanceFleetPoolPresence({
			previous: first.state,
			members: [worker("dirk")],
			listings: listing("dirk"),
			nowMs: 2_000,
		});
		expect(removed.state.has(fleetPoolPresenceKey("big", ENDPOINT))).toBe(false);
		expect(removed.losses).toEqual([]);
	});

	it("matches on any id the endpoint reports — runtime alias or real key", () => {
		const result = advanceFleetPoolPresence({
			previous: empty,
			members: [worker("qwen/qwen3.8-27b")],
			listings: [{ endpoint: ENDPOINT, loadedModelIds: ["qwen3.8-27b-instance-2", "qwen/qwen3.8-27b"] }],
			nowMs: 1_000,
		});
		expect(result.state.get(fleetPoolPresenceKey("qwen/qwen3.8-27b", ENDPOINT))?.state).toBe("present");
	});
});

describe("fleet pool presence ledger", () => {
	beforeEach(() => {
		resetFleetPoolPresenceForTests();
	});

	it("lists declared losses oldest first and remembers the sweep time", () => {
		expect(listFleetPoolLosses()).toEqual([]);
		expect(fleetPoolLastSweptAtMs()).toBeNull();
		let state = empty;
		const members = [worker("dirk"), worker("later")];
		state = advanceFleetPoolPresence({ previous: state, members, listings: listing("later"), nowMs: 1_000 }).state;
		state = advanceFleetPoolPresence({ previous: state, members, listings: listing(), nowMs: 2_000 }).state;
		state = advanceFleetPoolPresence({ previous: state, members, listings: listing(), nowMs: 3_000 }).state;
		commitFleetPoolSweep(state, 3_000);
		expect(fleetPoolLastSweptAtMs()).toBe(3_000);
		expect(listFleetPoolLosses().map((loss) => [loss.modelId, loss.declaredAtMs, loss.lastSeenAtMs])).toEqual([
			["dirk", 2_000, null],
			["later", 3_000, 1_000],
		]);
	});
});
