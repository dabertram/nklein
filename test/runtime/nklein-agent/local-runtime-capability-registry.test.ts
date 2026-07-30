import { describe, expect, it } from "vitest";
import {
	findLocalRuntimeCapability,
	LOCAL_RUNTIME_CAPABILITIES,
} from "../../../src/nklein-agent/local-runtime-capability-registry";

/**
 * P17.6 — guards for the KV-cache-persistence capability claim.
 *
 * This field decides whether !Klein may ever SKIP prefill it would otherwise pay. A wrong `true` does not
 * degrade gracefully: it silently serves a model state that was never restored. So the invariant under test is
 * not "the values are right today" but "the default is the pessimistic one, and turning any of them on is a
 * deliberate act that trips a test rather than sliding in with an edit."
 */
describe("local runtime KV-cache persistence capability", () => {
	it("is FAIL-CLOSED for every registered runtime until a probe proves otherwise", () => {
		// LM Studio is verified-false on evidence (MLX clears the store on unload; its llama.cpp argv omits
		// --slot-save-path). ollama/mlxserve are false because that is the safe default, NOT because they were
		// tested. Flipping any of these must be accompanied by a real save/restore round-trip.
		for (const capability of LOCAL_RUNTIME_CAPABILITIES) {
			expect(
				capability.persistsKvCacheAcrossUnload,
				`${capability.providerId} claims KV persistence — that claim needs a verified round-trip, not a default`,
			).toBe(false);
		}
	});

	it("resolves the capability through aliases too, so a spelling cannot bypass the claim", () => {
		// The whole point of this registry is that provider-id spellings stop being scattered string gates; a
		// capability that only resolves for the canonical id would reintroduce exactly that hazard.
		for (const capability of LOCAL_RUNTIME_CAPABILITIES) {
			for (const alias of capability.aliases) {
				expect(findLocalRuntimeCapability(alias)?.persistsKvCacheAcrossUnload).toBe(
					capability.persistsKvCacheAcrossUnload,
				);
			}
		}
	});

	it("treats an unknown runtime as incapable rather than assuming the best", () => {
		expect(findLocalRuntimeCapability("some-runtime-we-have-never-seen")?.persistsKvCacheAcrossUnload ?? false).toBe(
			false,
		);
	});
});
