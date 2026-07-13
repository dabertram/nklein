import { describe, expect, it } from "vitest";
import {
	applyRailControlCommand,
	composeRailStatus,
	createRailOutcomeLog,
	createRailStatusPublisher,
	INITIAL_RAIL_CONTROL_STATE,
	type RailControlState,
	type RailStatusSnapshot,
} from "../../../src/core/background-eval-controls";

/**
 * F1.35 — rail controls/status core: the enable/pause reducer's start/stop actions (idempotent), the bounded
 * outcome log, the status composer's run-state derivation, and the change-only push publisher (no poll loop).
 */

function control(overrides: Partial<RailControlState> = {}): RailControlState {
	return { ...INITIAL_RAIL_CONTROL_STATE, ...overrides };
}

describe("applyRailControlCommand", () => {
	it("enable from cold starts the service; a second enable is a no-op", () => {
		const first = applyRailControlCommand(INITIAL_RAIL_CONTROL_STATE, { kind: "enable" });
		expect(first.action).toBe("start");
		expect(first.state.enabled).toBe(true);
		const second = applyRailControlCommand(first.state, { kind: "enable" });
		expect(second.action).toBe("none"); // double-click / replay never bounces the service
	});

	it("pause stops the service but keeps the enabled intent; resume restarts", () => {
		const paused = applyRailControlCommand(control({ enabled: true }), { kind: "pause", reason: "  demo run  " });
		expect(paused.action).toBe("stop");
		expect(paused.state).toEqual({ enabled: true, paused: true, pauseReason: "demo run" });
		const resumed = applyRailControlCommand(paused.state, { kind: "resume" });
		expect(resumed.action).toBe("start");
		expect(resumed.state.pauseReason).toBeNull();
	});

	it("disable clears the pause hold; pausing while disabled never starts/stops anything", () => {
		const disabled = applyRailControlCommand(control({ enabled: true, paused: true, pauseReason: "x" }), {
			kind: "disable",
		});
		expect(disabled.action).toBe("none"); // was paused (inactive) → still inactive
		expect(disabled.state).toEqual(INITIAL_RAIL_CONTROL_STATE);
		const pausedWhileDisabled = applyRailControlCommand(INITIAL_RAIL_CONTROL_STATE, { kind: "pause" });
		expect(pausedWhileDisabled.action).toBe("none");
		// Enabling a paused-while-disabled rail must NOT start it (the pause hold survives).
		const enabledButPaused = applyRailControlCommand(pausedWhileDisabled.state, { kind: "enable" });
		expect(enabledButPaused.action).toBe("none");
	});
});

describe("createRailOutcomeLog", () => {
	it("keeps the newest N outcomes, newest first", () => {
		const log = createRailOutcomeLog(2);
		log.record({ at: 1, reason: "admitted", admittedProject: "a", reapedCount: 0 });
		log.record({ at: 2, reason: "no_project_to_run", admittedProject: null, reapedCount: 1 });
		log.record({ at: 3, reason: "admitted", admittedProject: "b", reapedCount: 0 });
		expect(log.list().map((outcome) => outcome.at)).toEqual([3, 2]);
	});
});

function statusInput(overrides: Partial<Parameters<typeof composeRailStatus>[0]> = {}) {
	return {
		control: control({ enabled: true }),
		cadenceMs: 60_000,
		maxConcurrentEvals: 2,
		timeoutProfile: "long",
		service: { activeLeases: [], lastTick: null, lastTickError: null, cleanupErrors: [] },
		recentOutcomes: [],
		...overrides,
	};
}

describe("composeRailStatus", () => {
	it("derives the run state: disabled / paused / active / idle", () => {
		expect(composeRailStatus(statusInput({ control: control() })).state).toBe("disabled");
		expect(composeRailStatus(statusInput({ control: control({ enabled: true, paused: true }) })).state).toBe(
			"paused",
		);
		const lease = { runId: "r1", project: "p", workspaceId: null, startedAt: 1, deadlineAt: 2 };
		expect(
			composeRailStatus(
				statusInput({
					service: { activeLeases: [lease], lastTick: null, lastTickError: null, cleanupErrors: [] },
				}),
			).state,
		).toBe("active");
		expect(composeRailStatus(statusInput()).state).toBe("idle");
	});

	it("surfaces cadence, cap, timeout profile, cleanup errors, and outcomes verbatim", () => {
		const snapshot = composeRailStatus(
			statusInput({
				service: {
					activeLeases: [],
					lastTick: { at: 5, reason: "yield_to_interactive", reapedCount: 0 },
					lastTickError: null,
					cleanupErrors: ["shutdown p (r1): sandbox stuck"],
				},
				recentOutcomes: [{ at: 5, reason: "yield_to_interactive", admittedProject: null, reapedCount: 0 }],
			}),
		);
		expect(snapshot.cadenceMs).toBe(60_000);
		expect(snapshot.maxConcurrentEvals).toBe(2);
		expect(snapshot.timeoutProfile).toBe("long");
		expect(snapshot.cleanupErrors).toHaveLength(1);
		expect(snapshot.recentOutcomes[0]?.reason).toBe("yield_to_interactive");
	});
});

describe("createRailStatusPublisher", () => {
	it("publishes only when the snapshot changes (push, not poll)", () => {
		let current = statusInput();
		const published: RailStatusSnapshot[] = [];
		const publisher = createRailStatusPublisher({
			compose: () => composeRailStatus(current),
			publish: (snapshot) => published.push(snapshot),
		});

		expect(publisher.notify()).toBe(true); // first snapshot always goes out
		expect(publisher.notify()).toBe(false); // identical → silent
		expect(publisher.notify()).toBe(false);
		current = statusInput({ control: control({ enabled: true, paused: true, pauseReason: "hold" }) });
		expect(publisher.notify()).toBe(true); // change → push
		expect(published).toHaveLength(2);
		expect(published[1].state).toBe("paused");
	});
});
