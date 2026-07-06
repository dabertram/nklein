import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { buildLoadedModelRoutingCandidates } from "../../../src/nklein-agent/nklein-loaded-model-candidates";
import { buildNKleinModelRegistryKey } from "../../../src/nklein-agent/nklein-model-registry-key";
import { deriveTaskFitnessRecord } from "../../../src/nklein-agent/task-fitness-recording";

/**
 * §5.BG read/write KEY-ALIGNMENT guard — the safety net whose ABSENCE let an earlier mismatch through.
 *
 * Model telemetry is only correct when the identity the routing READ side keys off (`candidate.entry.key`) is the SAME
 * identity the telemetry WRITE side stamps (the fitness cell key). A one-sided change — e.g. flipping the write to the
 * stable publisher key while the routing read still keys off the runtime id — SILENTLY breaks selection: evidence
 * written under one key is never found under the other, and no per-function unit test catches it. This pins that the two
 * paths derive the SAME registry key for the same model coordinates, so any future divergence fails loudly HERE.
 *
 * When the §5.BG stable-key switch lands, BOTH sides move together (this test is UPDATED, not deleted, to assert they
 * now agree on the stable key).
 */
describe("model-telemetry key alignment (§5.BG): routing READ key == fitness WRITE key", () => {
	const providerId = "lmstudio";
	const modelId = "coder-gpu"; // a runtime id (an LM Studio per-instance alias)
	const endpoint = "http://localhost:1234/v1";

	it("a routing candidate's entry.key equals the fitness write key for the same model coordinates", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: [modelId],
			registryEntries: [],
			providerId,
			endpoint,
			now: 0,
		});
		const candidate = candidates[0];
		const fitness = deriveTaskFitnessRecord({
			summary: {
				taskId: "t1",
				providerId,
				modelId,
				endpoint,
				state: "awaiting_review",
				startedAt: 0,
				updatedAt: 1,
			} as RuntimeTaskSessionSummary,
			card: { id: "t1", title: "x" } as RuntimeBoardCard,
		});

		expect(candidate?.entry.key).toBeDefined();
		expect(fitness?.key.modelKey).toBeDefined();
		// THE INVARIANT: the read side (routing candidate) and the write side (fitness) agree on the model's identity.
		expect(candidate?.entry.key).toBe(fitness?.key.modelKey);
		// …and both are the canonical registry key for these coordinates (runtime-keyed today, pre-§5.BG-flip).
		expect(candidate?.entry.key).toBe(buildNKleinModelRegistryKey({ providerId, modelId, endpoint }));
	});
});
