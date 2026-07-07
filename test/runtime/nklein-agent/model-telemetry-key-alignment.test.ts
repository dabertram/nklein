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
 * of this coupling and may key stably on their own.
 *
 * §5.BG (c) UPDATE (2026-07-07): the stable-key flip LANDED, flag-gated behind `NKLEIN_STABLE_ROUTING_KEY` (default OFF).
 * With the flag OFF the routing keys are the RUNTIME-derived keys this test pins (byte-identical) — so these assertions
 * stay valid as the default-behavior guard. With the flag ON, the candidate READ (guardCandidates re-key), the ledger
 * WRITE (service), and the residency set all resolve the SAME stable id via `resolveStableRoutingModelId` (one shared
 * map) — their alignment (and the rename-heal that two aliases collapse to ONE key) is pinned in
 * `test/runtime/state/runtime-id-model-key-map-store.test.ts`.
 */
describe("model-telemetry ROUTING key alignment (§5.BG): candidate READ key == ledger WRITE key == residency key", () => {
	const providerId = "lmstudio";
	const modelId = "coder-gpu"; // a runtime id (an LM Studio per-instance alias)
	const endpoint = "http://localhost:1234/v1";

	const candidateFor = (id: string) =>
		buildLoadedModelRoutingCandidates({ loadedModelIds: [id], registryEntries: [], providerId, endpoint, now: 0 })[0];

	it("candidate.entry.key == the terminal-attempt ledger event's modelId (the routing evidence loop)", () => {
		const candidate = candidateFor(modelId);
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
		expect(candidate?.entry.key).toBe(buildNKleinModelRegistryKey({ providerId, modelId, endpoint }));
	});

	it("★ candidate.entry.key == the RESIDENCY key (or a running model looks FREE → double-start)", () => {
		// `runningModelKeys` (start-task-session) is built from each RUNNING session's coords via the SAME
		// buildNKleinModelRegistryKey, and `isModelFree` compares it to candidate.entry.key. If these diverge — the
		// candidate flips to the stable key while the residency set stays runtime-keyed — a currently-running model is
		// NOT found in the set, is treated as FREE, and gets STARTED AGAIN. This guards that coupling: when §5.BG flips
		// candidate.entry.key to the stable key, the residency-key construction MUST flip in the same commit (this
		// assertion goes red otherwise).
		const candidate = candidateFor(modelId);
		const residencyKey = buildNKleinModelRegistryKey({ providerId, modelId, endpoint });
		expect(residencyKey).toBe(candidate?.entry.key);
	});

	it("VERDICT coupling note: entry.modelId is BOTH the invocation id and (today) the verdict-match id", () => {
		// The runtime-verdict (assessRuntimeModelVerdict) filters self-observations by `candidate.entry.modelId`, and
		// observations are stamped with the same raw modelId. entry.modelId is ALSO the id used to LAUNCH the model, so
		// it must stay the RUNTIME id. When §5.BG lands, observations stamp the STABLE key → the verdict must match by a
		// NEW stable field on the candidate (entry.modelKey), NOT entry.modelId. Pins the current runtime coupling.
		expect(candidateFor(modelId)?.entry.modelId).toBe(modelId);
	});
});
