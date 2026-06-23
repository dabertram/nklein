import { describe, expect, it } from "vitest";
import { deriveOpenQuestionDefaults } from "../../../src/nklein-sdk/nklein-decomposition-tool";
import type { NKleinPlanQuestion } from "../../../src/nklein-sdk/nklein-plan-artifacts";

function question(overrides: Partial<NKleinPlanQuestion>): NKleinPlanQuestion {
	return {
		id: "q1",
		question: "Will the audio core use Web Audio or native bindings?",
		status: "open",
		options: [],
		answer: null,
		assumption: null,
		...overrides,
	};
}

describe("deriveOpenQuestionDefaults (decompose parse-and-recover, real-evidence regression)", () => {
	it("auto-supplies an assumption from the recommended option so an open question can proceed", () => {
		const [resolved] = deriveOpenQuestionDefaults([
			question({
				options: [
					{ id: "web-audio", label: "Web Audio + AudioWorklet", description: null, recommended: true },
					{ id: "native", label: "Native WASM/FFI core", description: null, recommended: false },
				],
			}),
		]);
		// Stays OPEN (so the §5.S clarify loop / user can still resolve it) but now carries a working default,
		// so the model no longer has to re-send the identical decompose call to add an assumption.
		expect(resolved?.status).toBe("open");
		expect(resolved?.assumption).toContain("Web Audio + AudioWorklet");
		expect(resolved?.assumption).toContain("recommended");
	});

	it("falls back to the first option when none is marked recommended", () => {
		const [resolved] = deriveOpenQuestionDefaults([
			question({
				options: [
					{ id: "a", label: "Option A", description: null, recommended: false },
					{ id: "b", label: "Option B", description: null, recommended: false },
				],
			}),
		]);
		expect(resolved?.assumption).toContain("Option A");
		expect(resolved?.assumption).not.toContain("recommended");
	});

	it("leaves an open question with no options untouched (nothing safe to assume)", () => {
		const input = question({ options: [] });
		expect(deriveOpenQuestionDefaults([input])[0]).toEqual(input);
	});

	it("never overwrites an existing assumption or answer, nor non-open questions", () => {
		const withAssumption = question({
			assumption: "Assume X",
			options: [{ id: "a", label: "A", description: null, recommended: true }],
		});
		const answered = question({ status: "answered", answer: "Use Web Audio" });
		const assumed = question({ status: "assumed-default", assumption: "Assume Web Audio" });
		const result = deriveOpenQuestionDefaults([withAssumption, answered, assumed]);
		expect(result[0]).toEqual(withAssumption);
		expect(result[1]).toEqual(answered);
		expect(result[2]).toEqual(assumed);
	});
});
