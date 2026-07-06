import { describe, expect, it } from "vitest";
import { buildTerminalAttemptEvent } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { buildLoadedModelRoutingCandidates } from "../../../src/nklein-agent/nklein-loaded-model-candidates";
import { buildNKleinModelRegistryKey } from "../../../src/nklein-agent/nklein-model-registry-key";

/**
 * §5.BG ROUTING read/write KEY-ALIGNMENT guard — the safety net whose ABSENCE let an earlier mismatch through.
 *
 * The routing evidence loop is: the terminal-attempt LEDGER event is WRITTEN with a registry-key `modelId`
 * (`nklein-ledger-attempt`), summarized into per-model success rates, and looked up at start by the routing candidate's
 * `entry.key`. Selection is only correct when the ledger WRITE key and the candidate READ key derive from the SAME model
 * identity. A one-sided change — flipping one to the stable publisher key while the other stays runtime-keyed — SILENTLY
 * breaks selection (evidence written under one key is never found under the other), and no per-function unit test catches
 * it (that is exactly the bug that shipped once). This pins that the two derive the SAME key for the same coordinates.
 *
 * NOTE: fitness + the model-behavior store are DISPLAY/inert (not read for routing), so they are intentionally NOT part
 * of this coupling and may key stably on their own. When the ROUTING cluster's stable-key switch lands, the ledger write
 * and the candidate read move together and this test is UPDATED (not deleted) to assert they agree on the stable key.
 */
describe("model-telemetry ROUTING key alignment (§5.BG): candidate READ key == ledger WRITE key", () => {
	const providerId = "lmstudio";
	const modelId = "coder-gpu"; // a runtime id (an LM Studio per-instance alias)
	const endpoint = "http://localhost:1234/v1";

	it("a routing candidate's entry.key equals the terminal-attempt ledger event's modelId for the same coordinates", () => {
		const candidate = buildLoadedModelRoutingCandidates({
			loadedModelIds: [modelId],
			registryEntries: [],
			providerId,
			endpoint,
			now: 0,
		})[0];

		const ledgerEvent = buildTerminalAttemptEvent({
			taskId: "t1",
			workspacePath: null,
			state: "awaiting_review",
			role: "worker",
			providerId,
			modelId, // the write side stamps the SAME runtime id the read side keys off
			endpoint,
			startedAt: 0,
			endedAt: 1,
			promptTokens: null,
			completionTokens: null,
			timeoutReason: null,
		});

		expect(candidate?.entry.key).toBeDefined();
		// THE INVARIANT: routing read identity (candidate.entry.key) == routing write identity (ledger event modelId).
		expect(candidate?.entry.key).toBe(ledgerEvent.modelId);
		// …and both are the canonical registry key for these coordinates (runtime-keyed today, pre-§5.BG routing flip).
		expect(candidate?.entry.key).toBe(buildNKleinModelRegistryKey({ providerId, modelId, endpoint }));
	});
});
