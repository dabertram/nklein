import { describe, expect, it } from "vitest";
import {
	type NKleinEndpointSchedulingRequest,
	type NKleinEndpointSessionSnapshot,
	scheduleNKleinEndpointStart,
} from "./nklein-endpoint-scheduler";
import type { NKleinModelRegistrySnapshot } from "./nklein-model-registry";

// P0.DSTALL self-block (2026-08-21, run-4 `.real-runs/20260821-031637`): a plan-mode architect died mid-decompose,
// its reservation was purged, but its qwen3.8-27b stayed resident+busy in LM Studio for a beat. Admission then
// synthesized an `external-lms:local:<model>` holder, and the dead-card rescue's OWN restart — wanting that same
// model — was blocked forever behind the phantom (`holder: external-lms:local:qwen3.8-27b-mlx`, seen in runtime.log).
// The scheduler must treat a same-model external-lms holder as reusable residency, never an occupant.

const EMPTY_REGISTRY: NKleinModelRegistrySnapshot = { schemaVersion: 1, updatedAt: 0, models: {} };
const MODEL = "qwen/qwen3.8-27b";
const ENDPOINT = "http://localhost:1234";

function request(overrides: Partial<NKleinEndpointSchedulingRequest> = {}): NKleinEndpointSchedulingRequest {
	return {
		taskId: "dead-card-restart",
		providerId: "lmstudio",
		modelId: MODEL,
		endpoint: ENDPOINT,
		modelRegistry: EMPTY_REGISTRY,
		hostConcurrencyCap: 1,
		machineByModelId: new Map([[MODEL, "local"]]),
		now: 1000,
		runningSessions: [],
		...overrides,
	};
}

function externalLmsHolder(modelId: string): NKleinEndpointSessionSnapshot {
	return {
		taskId: `external-lms:local:${modelId}`,
		state: "running",
		providerId: "lmstudio",
		modelId,
		endpoint: ENDPOINT,
		hostId: "local",
	};
}

describe("scheduleNKleinEndpointStart — external-lms same-model reuse (P0.DSTALL self-block)", () => {
	it("admits a restart blocked ONLY by its own dead session's same-model external-lms residency", () => {
		// Reproduces the bug: without the reuse carve-out the host gate counts the phantom (1 >= cap 1) and holds forever.
		const decision = scheduleNKleinEndpointStart(request({ runningSessions: [externalLmsHolder(MODEL)] }));
		expect(decision.ok).toBe(true);
	});

	it("STILL holds when a DIFFERENT model is externally resident — a second load would blow the host's memory", () => {
		const decision = scheduleNKleinEndpointStart(request({ runningSessions: [externalLmsHolder("some-other-70b")] }));
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.blockedByTaskId).toBe("external-lms:local:some-other-70b");
		}
	});

	it("STILL holds behind a TRACKED same-model session — the waiver never relaxes the real per-host cap", () => {
		const tracked: NKleinEndpointSessionSnapshot = {
			taskId: "sibling-real-task",
			state: "running",
			providerId: "lmstudio",
			modelId: MODEL,
			endpoint: ENDPOINT,
			hostId: "local",
		};
		const decision = scheduleNKleinEndpointStart(request({ runningSessions: [tracked] }));
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.blockedByTaskId).toBe("sibling-real-task");
		}
	});
});
