import { describe, expect, it, vi } from "vitest";
import { createRailOutcomeLog } from "../../../src/core/background-eval-controls";
import type { BackgroundEvalService } from "../../../src/server/background-eval-service";
import { createRailControlCoordinator } from "../../../src/server/rail-control-service";
import { DEFAULT_RAIL_CONTROL_SETTINGS, type RailControlSettings } from "../../../src/state/rail-control-store";

function inMemorySettings(initial: RailControlSettings = DEFAULT_RAIL_CONTROL_SETTINGS) {
	let current: RailControlSettings = { ...initial, control: { ...initial.control } };
	return {
		loadSettings: async () => current,
		saveSettings: async (s: RailControlSettings) => {
			current = s;
		},
		get: () => current,
	};
}

function fakeService(): BackgroundEvalService & { starts: number; stops: number } {
	const svc = {
		starts: 0,
		stops: 0,
		start: vi.fn(async () => {
			svc.starts += 1;
		}),
		stop: vi.fn(async () => {
			svc.stops += 1;
		}),
		tickNow: vi.fn(async () => null),
		getStatus: () => ({
			running: svc.starts > svc.stops,
			activeLeases: [],
			lastTick: null,
			lastTickError: null,
			cleanupErrors: [],
		}),
	};
	return svc as unknown as BackgroundEvalService & { starts: number; stops: number };
}

describe("createRailControlCoordinator (F1.35b)", () => {
	it("with NO hosted service: persists control intent + status reads disabled, nothing to start", async () => {
		const store = inMemorySettings();
		const coord = createRailControlCoordinator({
			loadSettings: store.loadSettings,
			saveSettings: store.saveSettings,
			service: null,
			outcomeLog: createRailOutcomeLog(),
		});

		expect((await coord.getStatus()).state).toBe("disabled");
		const afterEnable = await coord.applyCommand({ kind: "enable" });
		// Enabled + no service ⇒ "idle" (enabled, not paused, no active leases).
		expect(afterEnable.state).toBe("idle");
		expect(store.get().control.enabled).toBe(true);
	});

	it("with a hosted service: enable starts it, pause stops it, resume restarts it (best-effort)", async () => {
		const store = inMemorySettings();
		const service = fakeService();
		const coord = createRailControlCoordinator({
			loadSettings: store.loadSettings,
			saveSettings: store.saveSettings,
			service,
			outcomeLog: createRailOutcomeLog(),
		});

		await coord.applyCommand({ kind: "enable" });
		expect(service.starts).toBe(1);
		await coord.applyCommand({ kind: "pause", reason: "heat" });
		expect(service.stops).toBe(1);
		expect(store.get().control.pauseReason).toBe("heat");
		await coord.applyCommand({ kind: "resume" });
		expect(service.starts).toBe(2);
	});

	it("a service start failure never rejects the control mutation", async () => {
		const store = inMemorySettings();
		const service = fakeService();
		(service.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
		const coord = createRailControlCoordinator({
			loadSettings: store.loadSettings,
			saveSettings: store.saveSettings,
			service,
			outcomeLog: createRailOutcomeLog(),
		});
		const status = await coord.applyCommand({ kind: "enable" });
		expect(status.state).toBe("idle"); // intent persisted despite the start throwing
		expect(store.get().control.enabled).toBe(true);
	});

	it("updateTunables clamps cadence/cap to their floors and persists them", async () => {
		const store = inMemorySettings();
		const coord = createRailControlCoordinator({
			loadSettings: store.loadSettings,
			saveSettings: store.saveSettings,
			service: null,
			outcomeLog: createRailOutcomeLog(),
		});
		const status = await coord.updateTunables({ cadenceMs: 10, maxConcurrentEvals: 0 });
		expect(status.cadenceMs).toBe(1_000);
		expect(status.maxConcurrentEvals).toBe(1);
		expect(store.get().cadenceMs).toBe(1_000);
	});

	it("syncServiceToPersistedIntent starts the service only when the persisted intent is active", async () => {
		const service = fakeService();
		const activeStore = inMemorySettings({
			control: { enabled: true, paused: false, pauseReason: null },
			cadenceMs: 300_000,
			maxConcurrentEvals: 1,
		});
		const coord = createRailControlCoordinator({
			loadSettings: activeStore.loadSettings,
			saveSettings: activeStore.saveSettings,
			service,
			outcomeLog: createRailOutcomeLog(),
		});
		await coord.syncServiceToPersistedIntent();
		expect(service.starts).toBe(1);

		// Paused intent ⇒ no start.
		const pausedService = fakeService();
		const pausedStore = inMemorySettings({
			control: { enabled: true, paused: true, pauseReason: "hold" },
			cadenceMs: 300_000,
			maxConcurrentEvals: 1,
		});
		const pausedCoord = createRailControlCoordinator({
			loadSettings: pausedStore.loadSettings,
			saveSettings: pausedStore.saveSettings,
			service: pausedService,
			outcomeLog: createRailOutcomeLog(),
		});
		await pausedCoord.syncServiceToPersistedIntent();
		expect(pausedService.starts).toBe(0);
	});
});
