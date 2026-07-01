import { describe, expect, it } from "vitest";

import {
	type CardDecompositionInput,
	DEFAULT_DECOMPOSITION_DECISION_OPTIONS,
	decideCardDecomposition,
} from "../../../src/core/adaptive-decomposition-decision";

/** Build an input with sane defaults; `over` overrides fields (and `model` is shallow-merged for ergonomics). */
const input = (
	over: Partial<CardDecompositionInput> & { model?: Partial<CardDecompositionInput["model"]> } = {},
): CardDecompositionInput => ({
	cardDifficulty: 50,
	...over,
	model: { capability: 80, chaining: "native", ...over.model },
});

const MARGIN = DEFAULT_DECOMPOSITION_DECISION_OPTIONS.directCapabilityMargin; // 15

describe("decideCardDecomposition — Rule 1 (reactive can't-handle signal)", () => {
	it("decomposes (confident) when a prior direct attempt raised the can't-handle signal", () => {
		const d = decideCardDecomposition(input({ priorCantHandleSignal: true }));
		expect(d.action).toBe("decompose");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 1/);
	});

	it("overrides an otherwise clearly run-direct case (reactive signal dominates the capability estimate)", () => {
		// capability 99, native chaining, easy card ⇒ would be Rule 4 run_direct WITHOUT the signal.
		const d = decideCardDecomposition(
			input({ cardDifficulty: 10, priorCantHandleSignal: true, model: { capability: 99, chaining: "native" } }),
		);
		expect(d.action).toBe("decompose");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 1/);
	});

	it("overrides even the chaining-floor case (Rule 1 has strict priority over Rule 2)", () => {
		const d = decideCardDecomposition(
			input({ priorCantHandleSignal: true, model: { capability: 80, chaining: "fails" } }),
		);
		expect(d.action).toBe("decompose");
		expect(d.reason).toMatch(/Rule 1/); // reactive, not chaining-floor
	});

	it("does NOT fire on priorCantHandleSignal === false (falls through to capability rules)", () => {
		const d = decideCardDecomposition(input({ priorCantHandleSignal: false }));
		expect(d.reason).not.toMatch(/Rule 1/);
	});
});

describe("decideCardDecomposition — Rule 2 (chaining floor)", () => {
	it("decomposes (confident) for chaining=single_only even when capability far clears difficulty", () => {
		const d = decideCardDecomposition(
			input({ cardDifficulty: 10, model: { capability: 99, chaining: "single_only" } }),
		);
		expect(d.action).toBe("decompose");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 2/);
		expect(d.reason).toContain("single_only");
	});

	it("decomposes (confident) for chaining=fails", () => {
		const d = decideCardDecomposition(input({ model: { capability: 90, chaining: "fails" } }));
		expect(d.action).toBe("decompose");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 2/);
	});

	it("takes priority over Rule 3 when capability is ALSO below difficulty (chaining floor wins first)", () => {
		// Both Rule 2 (single_only) and Rule 3 (30 < 50) apply; Rule 2 is checked first.
		const d = decideCardDecomposition(
			input({ cardDifficulty: 50, model: { capability: 30, chaining: "single_only" } }),
		);
		expect(d.action).toBe("decompose");
		expect(d.reason).toMatch(/Rule 2/);
	});
});

describe("decideCardDecomposition — Rule 3 (capability below difficulty)", () => {
	it("decomposes (confident) when capability < cardDifficulty", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 70, model: { capability: 40, chaining: "native" } }));
		expect(d.action).toBe("decompose");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 3/);
	});

	it("fires even with strong (native) chaining — chaining doesn't rescue a below-difficulty model", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 60, model: { capability: 59, chaining: "native" } }));
		expect(d.action).toBe("decompose");
		expect(d.reason).toMatch(/Rule 3/);
	});

	it("does NOT fire at the exact boundary capability === cardDifficulty (not strictly below)", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 50, chaining: "native" } }));
		expect(d.reason).not.toMatch(/Rule 3/);
		expect(d.action).toBe("run_direct"); // clears difficulty (equal), within margin ⇒ Rule 5
	});
});

describe("decideCardDecomposition — Rule 4 (clearly capable + chain-capable ⇒ run direct)", () => {
	it("runs direct (confident) when capability >= difficulty + margin and chaining=native", () => {
		const d = decideCardDecomposition(
			input({ cardDifficulty: 50, model: { capability: 50 + MARGIN, chaining: "native" } }),
		);
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 4/);
	});

	it("runs direct (confident) for chaining=via_force (force-advance scaffold counts as chain-capable)", () => {
		const d = decideCardDecomposition(
			input({ cardDifficulty: 40, model: { capability: 90, chaining: "via_force" } }),
		);
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 4/);
		expect(d.reason).toContain("via_force");
	});

	it("does NOT run confident-direct when the margin is cleared but chaining is unknown (falls to Rule 5)", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 40, model: { capability: 90, chaining: "unknown" } }));
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/Rule 5/);
	});
});

describe("decideCardDecomposition — Rule 5 (marginal, ADaPT: try direct, un-confident)", () => {
	it("runs direct un-confidently when capability clears difficulty but is within the margin", () => {
		// 50 <= capability < 65 clears difficulty but not the +15 margin.
		const d = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 60, chaining: "native" } }));
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/Rule 5/);
		expect(d.reason).toMatch(/within margin/);
	});

	it("runs direct un-confidently at the exact difficulty boundary (capability === difficulty)", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 50, chaining: "native" } }));
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/Rule 5/);
	});

	it("cites the chaining cause when capability clears the margin but chaining is unknown", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 30, model: { capability: 90, chaining: "unknown" } }));
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/not confirmed chain-capable/);
	});
});

describe("decideCardDecomposition — margin boundary", () => {
	it("capability exactly at difficulty + margin with native chaining ⇒ confident run_direct (>= is inclusive)", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 65, chaining: "native" } }));
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 4/);
	});

	it("one point below the margin with native chaining ⇒ un-confident run_direct (Rule 5)", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 64, chaining: "native" } }));
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/Rule 5/);
	});

	it("respects a custom directCapabilityMargin (tunable)", () => {
		// With margin 5, capability 56 (>= 50+5) + native ⇒ confident Rule 4, whereas default margin 15 would be Rule 5.
		const strong = decideCardDecomposition(
			input({ cardDifficulty: 50, model: { capability: 56, chaining: "native" } }),
			{
				directCapabilityMargin: 5,
			},
		);
		expect(strong.confident).toBe(true);
		expect(strong.reason).toMatch(/Rule 4/);

		const def = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 56, chaining: "native" } }));
		expect(def.confident).toBe(false);
		expect(def.reason).toMatch(/Rule 5/);
	});

	it("a wider custom margin can push an otherwise-confident case down to marginal", () => {
		const d = decideCardDecomposition(input({ cardDifficulty: 50, model: { capability: 70, chaining: "native" } }), {
			directCapabilityMargin: 25, // needs >= 75, capability 70 falls short
		});
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/Rule 5/);
	});
});

describe("decideCardDecomposition — unknown-fields conservatism", () => {
	it("omitted chaining is treated as unknown ⇒ never a confident run_direct even when capability is high", () => {
		const d = decideCardDecomposition({ cardDifficulty: 20, model: { capability: 95 } });
		expect(d.action).toBe("run_direct");
		expect(d.confident).toBe(false);
		expect(d.reason).toMatch(/Rule 5/);
	});

	it("omitted chaining with capability below difficulty still decomposes via Rule 3 (capability is always known)", () => {
		const d = decideCardDecomposition({ cardDifficulty: 80, model: { capability: 40 } });
		expect(d.action).toBe("decompose");
		expect(d.confident).toBe(true);
		expect(d.reason).toMatch(/Rule 3/);
	});

	it("synthesis is carried but does not affect the decision (chaining is the gating axis)", () => {
		const withWeak = decideCardDecomposition(
			input({ model: { capability: 90, chaining: "native", synthesis: "weak" } }),
		);
		const withFull = decideCardDecomposition(
			input({ model: { capability: 90, chaining: "native", synthesis: "full" } }),
		);
		expect(withWeak).toEqual(withFull);
	});
});

describe("decideCardDecomposition — determinism", () => {
	it("returns an identical decision for repeated identical calls (each rule branch)", () => {
		const cases: CardDecompositionInput[] = [
			input({ priorCantHandleSignal: true }), // Rule 1
			input({ model: { capability: 90, chaining: "fails" } }), // Rule 2
			input({ cardDifficulty: 70, model: { capability: 40, chaining: "native" } }), // Rule 3
			input({ cardDifficulty: 50, model: { capability: 80, chaining: "native" } }), // Rule 4
			input({ cardDifficulty: 50, model: { capability: 55, chaining: "native" } }), // Rule 5
		];
		for (const c of cases) {
			const first = decideCardDecomposition(c);
			for (let i = 0; i < 5; i++) {
				expect(decideCardDecomposition(c)).toEqual(first);
			}
		}
	});

	it("does not mutate its input", () => {
		const original: CardDecompositionInput = input({
			cardDifficulty: 50,
			model: { capability: 80, chaining: "native" },
		});
		const snapshot = structuredClone(original);
		decideCardDecomposition(original);
		expect(original).toEqual(snapshot);
	});
});
