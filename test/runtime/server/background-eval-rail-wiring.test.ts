import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionState } from "../../../src/core/api-contract";
import {
	type BackgroundEvalRailWiringDeps,
	wireBackgroundEvalRail,
} from "../../../src/server/background-eval-rail-wiring";
import { DEFAULT_RAIL_CONTROL_SETTINGS, type RailControlSettings } from "../../../src/state/rail-control-store";

function wiringDeps(over: Partial<BackgroundEvalRailWiringDeps> = {}): BackgroundEvalRailWiringDeps {
	return {
		enabled: true,
		now: () => 1_000,
		maxConcurrentEvals: 1,
		tickIntervalMs: 60_000,
		maxRunMs: 300_000,
		scenarioIds: ["smoke_a", "smoke_b"],
		scaffoldEvalWorkspace: async (id) => ({ workspacePath: `/tmp/${id}`, workspaceId: `ws-${id}` }),
		startEvalSession: async () => {},
		getEvalSessionState: async () => "running" as RuntimeTaskSessionState,
		stopEvalSession: async () => {},
		removeWorkspace: async () => {},
		resolveWorkspacePathById: (id) => `/recovered/${id}`,
		getSignals: async () => ({ hasInteractiveWork: false, loadedModelIdle: true, resourceHeadroom: true }),
		loadCheckpoint: async () => [],
		saveCheckpoint: async () => {},
		loadSettings: async () => DEFAULT_RAIL_CONTROL_SETTINGS,
		saveSettings: async () => {},
		...over,
	};
}

describe("wireBackgroundEvalRail (F1.31b)", () => {
	it("with the flag OFF hosts no service; the coordinator still serves controls (disabled)", async () => {
		const wiring = wireBackgroundEvalRail(wiringDeps({ enabled: false }));
		expect(wiring.service).toBeNull();
		expect((await wiring.coordinator.getStatus()).state).toBe("disabled");
		await wiring.startAtBoot(); // no-op, must not throw
		await wiring.stop();
	});

	it("with the flag ON hosts a service the coordinator can drive", async () => {
		const wiring = wireBackgroundEvalRail(wiringDeps({ enabled: true }));
		expect(wiring.service).not.toBeNull();
		const status = await wiring.coordinator.applyCommand({ kind: "enable" });
		// Enabled + a hosted service with no active leases yet ⇒ idle.
		expect(status.state).toBe("idle");
		await wiring.stop();
	});

	it("startAtBoot starts the service when the persisted intent is already active", async () => {
		const active: RailControlSettings = {
			control: { enabled: true, paused: false, pauseReason: null },
			cadenceMs: 300_000,
			maxConcurrentEvals: 1,
		};
		const stopSpy = vi.fn(async () => {});
		const wiring = wireBackgroundEvalRail(
			wiringDeps({ enabled: true, loadSettings: async () => active, stopEvalSession: stopSpy }),
		);
		await wiring.startAtBoot();
		// The service is running now → stop() tears it down without throwing.
		await wiring.stop();
	});

	it("F1.32b: selectTarget replaces the round-robin and threads the picked MODEL into startEvalSession", async () => {
		const started: Array<{ scenarioId: string; modelId: string | null }> = [];
		const targets = [
			{ scenarioId: "smoke_a", modelId: "strong-32b" },
			{ scenarioId: "smoke_b", modelId: null },
			null,
		];
		let cursor = 0;
		const wiring = wireBackgroundEvalRail(
			wiringDeps({
				getEvalSessionState: async () => "awaiting_review" as RuntimeTaskSessionState,
				selectTarget: async () => targets[cursor++] ?? null,
				startEvalSession: async ({ scenarioId, modelId }) => {
					started.push({ scenarioId, modelId });
				},
			}),
		);
		await wiring.service?.tickNow();
		await wiring.service?.tickNow();
		await wiring.service?.tickNow();
		await wiring.stop();
		// Two picked targets started (with their models); the null pick admitted nothing.
		expect(started).toEqual([
			{ scenarioId: "smoke_a", modelId: "strong-32b" },
			{ scenarioId: "smoke_b", modelId: null },
		]);
	});

	it("round-robins scenarios across ticks via the runner's selectNextProject", async () => {
		// Reach into the service deps indirectly: two selections should alternate the ids.
		const picks: (string | null)[] = [];
		const wiring = wireBackgroundEvalRail(
			wiringDeps({
				enabled: true,
				scenarioIds: ["a", "b", "c"],
				// Each started run reports a TERMINAL state, so the next tick reaps it and (cap=1) admits the next scenario.
				getEvalSessionState: async () => "awaiting_review" as RuntimeTaskSessionState,
				// startEvalSession records the scenario the picker chose (via scaffold path).
				scaffoldEvalWorkspace: async (id) => {
					picks.push(id);
					return { workspacePath: `/tmp/${id}`, workspaceId: `ws-${id}` };
				},
			}),
		);
		// Directly exercise the runner's selection+start by ticking would need the service; instead assert the picker
		// alternates by starting three runs through the service's tickNow.
		await wiring.service?.tickNow();
		await wiring.service?.tickNow();
		await wiring.service?.tickNow();
		await wiring.stop();
		// The first three admitted ticks should have scaffolded a, b, c in order (idle signals admit).
		expect(picks).toEqual(["a", "b", "c"]);
	});
});
