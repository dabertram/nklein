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

/**
 * P21.3 — guards for the served-context honesty claim.
 *
 * The danger this field tracks is SILENT: a runtime that advertises 32k and serves 2k discards most of the
 * prompt and errors nowhere — the model simply answers from a fraction of its input. So the invariant is not
 * "the values are right today" but "only a real probe can produce `verified`, and everything else stays
 * pessimistic."
 */
describe("local runtime served-context honesty capability", () => {
	it("marks ONLY the runtime that was actually probed as verified", () => {
		// LM Studio earned `verified` from a live needle probe (P21.3b, 2026-07-20): a fitting prompt was fully
		// ingested and recalled, an over-window prompt failed loud. Nothing else has been probed.
		expect(findLocalRuntimeCapability("lmstudio")?.servedContextHonesty).toBe("verified");
		for (const providerId of ["ollama", "mlxserve"]) {
			expect(
				findLocalRuntimeCapability(providerId)?.servedContextHonesty,
				`${providerId} claims a context-honesty verdict it never earned by probe`,
			).toBe("unverified");
		}
	});

	it("resolves through aliases too, so a spelling cannot inherit the wrong verdict", () => {
		for (const capability of LOCAL_RUNTIME_CAPABILITIES) {
			for (const alias of capability.aliases) {
				expect(findLocalRuntimeCapability(alias)?.servedContextHonesty).toBe(capability.servedContextHonesty);
			}
		}
	});

	it("treats an unknown runtime as UNVERIFIED rather than assuming it is honest", () => {
		// The whole point: when a new adapter appears, it must not inherit LM Studio's verdict by silence.
		expect(findLocalRuntimeCapability("some-runtime-we-have-never-seen")?.servedContextHonesty ?? "unverified").toBe(
			"unverified",
		);
	});

	it("never records `silently_truncated` from documentation alone — this field holds OUR measurements", () => {
		// Ollama's 2k-default trap is documented upstream and is the reason P21.3 exists, but !Klein has never
		// probed an instance. Recording a verdict we did not measure would make the registry look evidential while
		// carrying hearsay — the same failure the nightly pack registry warns about.
		for (const capability of LOCAL_RUNTIME_CAPABILITIES) {
			if (capability.servedContextHonesty === "silently_truncated") {
				throw new Error(
					`${capability.providerId} records silently_truncated — only a real probe may set that, update this test with the evidence`,
				);
			}
		}
	});
});
