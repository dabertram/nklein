import { describe, expect, it } from "vitest";
import {
	type ClarificationSelectionMode,
	DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
	meetsClarificationOptionFloor,
	type PrepareClarificationOptionSetConfig,
	prepareClarificationOptionSet,
	SYNTHESISED_OPTION_LABELS,
} from "../../../src/core/clarification-option-set";
import type { NKleinPlanQuestion, NKleinPlanQuestionOption } from "../../../src/nklein-agent/nklein-plan-artifacts";

function option(overrides: Partial<NKleinPlanQuestionOption> = {}): NKleinPlanQuestionOption {
	return {
		id: overrides.id ?? "opt",
		label: overrides.label ?? "Option",
		description: overrides.description ?? null,
		recommended: overrides.recommended ?? false,
	};
}

function question(overrides: Partial<NKleinPlanQuestion> = {}): NKleinPlanQuestion {
	return {
		id: overrides.id ?? "q1",
		question: overrides.question ?? "Which storage backend should we use?",
		status: overrides.status ?? "open",
		options: overrides.options ?? [],
		answer: overrides.answer ?? null,
		assumption: overrides.assumption ?? null,
		blockedTaskId: null,
	};
}

describe("prepareClarificationOptionSet — the ≥N floor", () => {
	it("pads an empty option set up to the default minimum of 4 with synthesised options", () => {
		const prepared = prepareClarificationOptionSet(question({ options: [] }));
		expect(prepared.options).toHaveLength(4);
		expect(prepared.suppliedCount).toBe(0);
		expect(prepared.synthesisedCount).toBe(4);
		expect(prepared.options.every((o) => o.synthesised)).toBe(true);
		// Synthesised labels come from the fixed pool, in order.
		expect(prepared.options.map((o) => o.label)).toEqual(SYNTHESISED_OPTION_LABELS.slice(0, 4));
	});

	it("pads a partially-supplied set to the floor and keeps the supplied options first", () => {
		const prepared = prepareClarificationOptionSet(
			question({ options: [option({ id: "a", label: "SQLite" }), option({ id: "b", label: "Postgres" })] }),
		);
		expect(prepared.options).toHaveLength(4);
		expect(prepared.suppliedCount).toBe(2);
		expect(prepared.synthesisedCount).toBe(2);
		expect(prepared.options.slice(0, 2).map((o) => o.label)).toEqual(["SQLite", "Postgres"]);
		expect(prepared.options.slice(0, 2).every((o) => !o.synthesised)).toBe(true);
		expect(prepared.options.slice(2).every((o) => o.synthesised)).toBe(true);
	});

	it("does not pad when the agent already supplied at least the floor", () => {
		const opts = [
			option({ id: "a", label: "One" }),
			option({ id: "b", label: "Two" }),
			option({ id: "c", label: "Three" }),
			option({ id: "d", label: "Four" }),
		];
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		expect(prepared.options).toHaveLength(4);
		expect(prepared.synthesisedCount).toBe(0);
		expect(prepared.options.every((o) => !o.synthesised)).toBe(true);
	});

	it("keeps all supplied options even when there are more than the floor", () => {
		const opts = Array.from({ length: 6 }, (_, i) => option({ id: `o${i}`, label: `Label ${i}` }));
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		expect(prepared.options).toHaveLength(6);
		expect(prepared.synthesisedCount).toBe(0);
	});
});

describe("prepareClarificationOptionSet — ordering", () => {
	it("orders every recommended option before the non-recommended ones, preserving relative order", () => {
		const opts = [
			option({ id: "a", label: "Alpha" }),
			option({ id: "b", label: "Bravo", recommended: true }),
			option({ id: "c", label: "Charlie" }),
			option({ id: "d", label: "Delta", recommended: true }),
		];
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		expect(prepared.options.map((o) => o.label)).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]);
	});

	it("always sorts synthesised options after every supplied option", () => {
		const prepared = prepareClarificationOptionSet(
			question({ options: [option({ id: "a", label: "Only real one", recommended: true })] }),
		);
		const firstSynthIndex = prepared.options.findIndex((o) => o.synthesised);
		const lastRealIndex = prepared.options.map((o) => o.synthesised).lastIndexOf(false);
		expect(lastRealIndex).toBeLessThan(firstSynthIndex);
	});
});

describe("prepareClarificationOptionSet — dedupe", () => {
	it("dedupes options with the same label case/space-insensitively, keeping the first", () => {
		const opts = [
			option({ id: "a", label: "Use Postgres", description: "first" }),
			option({ id: "b", label: "  use postgres ", description: "second" }),
		];
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		const real = prepared.options.filter((o) => !o.synthesised);
		expect(real).toHaveLength(1);
		expect(real[0]).toMatchObject({ id: "a", label: "Use Postgres", description: "first" });
	});

	it("promotes recommended when a later duplicate is recommended", () => {
		const opts = [
			option({ id: "a", label: "Same", recommended: false }),
			option({ id: "b", label: "same", recommended: true }),
		];
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		const real = prepared.options.filter((o) => !o.synthesised);
		expect(real).toHaveLength(1);
		expect(real[0].recommended).toBe(true);
	});

	it("drops options with an empty label or id (unrenderable) and pads the shortfall", () => {
		const opts = [
			option({ id: "a", label: "Keep me" }),
			option({ id: "", label: "No id" }),
			option({ id: "c", label: "   " }),
		];
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		expect(prepared.suppliedCount).toBe(1);
		expect(prepared.options.filter((o) => !o.synthesised).map((o) => o.label)).toEqual(["Keep me"]);
		expect(prepared.options).toHaveLength(4);
	});

	it("never lets a synthesised label duplicate a supplied one", () => {
		// Supply the first synthesised label verbatim; synthesis must skip it and draw the next pool entry.
		const opts = [option({ id: "a", label: SYNTHESISED_OPTION_LABELS[0] })];
		const prepared = prepareClarificationOptionSet(question({ options: opts }));
		const labels = prepared.options.map((o) => o.label);
		const occurrences = labels.filter((l) => l === SYNTHESISED_OPTION_LABELS[0]).length;
		expect(occurrences).toBe(1);
		expect(prepared.options).toHaveLength(4);
	});
});

describe("prepareClarificationOptionSet — config", () => {
	it("carries the free-text affordance and selection mode from the default config", () => {
		const prepared = prepareClarificationOptionSet(question());
		expect(prepared.allowFreeText).toBe(true);
		expect(prepared.selectionMode).toBe("single");
	});

	it("honours a multiple selection mode and a disabled free-text field", () => {
		const config: PrepareClarificationOptionSetConfig = {
			minOptions: 4,
			allowFreeText: false,
			selectionMode: "multiple",
		};
		const prepared = prepareClarificationOptionSet(question(), config);
		expect(prepared.allowFreeText).toBe(false);
		expect(prepared.selectionMode).toBe("multiple");
	});

	it("treats a non-finite / negative / zero minOptions as no floor (no padding)", () => {
		for (const bad of [Number.NaN, -3, 0, Number.POSITIVE_INFINITY]) {
			const prepared = prepareClarificationOptionSet(question({ options: [option({ id: "a", label: "One" })] }), {
				...DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
				minOptions: bad,
			});
			// Infinity clamps to "no floor" too (guarded), so only the single supplied option survives.
			expect(prepared.synthesisedCount).toBe(0);
			expect(prepared.options).toHaveLength(1);
		}
	});

	it("truncates a fractional minOptions floor", () => {
		const prepared = prepareClarificationOptionSet(question({ options: [] }), {
			...DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
			minOptions: 3.9,
		});
		expect(prepared.options).toHaveLength(3);
	});

	it("caps synthesis at the fixed label pool — an over-large floor cannot fabricate junk beyond the pool", () => {
		const prepared = prepareClarificationOptionSet(question({ options: [] }), {
			...DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
			minOptions: 99,
		});
		expect(prepared.options).toHaveLength(SYNTHESISED_OPTION_LABELS.length);
		expect(prepared.synthesisedCount).toBe(SYNTHESISED_OPTION_LABELS.length);
	});
});

describe("prepareClarificationOptionSet — question text + ids", () => {
	it("carries the question text verbatim", () => {
		const prepared = prepareClarificationOptionSet(question({ question: "Radio or checkbox?" }));
		expect(prepared.question).toBe("Radio or checkbox?");
	});

	it("trims supplied ids/labels/descriptions and produces unique synthesised ids", () => {
		const prepared = prepareClarificationOptionSet(
			question({ options: [option({ id: " a ", label: "  Trimmed  ", description: "  desc  " })] }),
		);
		const real = prepared.options.find((o) => !o.synthesised);
		expect(real).toMatchObject({ id: "a", label: "Trimmed", description: "desc" });
		const ids = prepared.options.map((o) => o.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("prepareClarificationOptionSet — purity", () => {
	it("is deterministic: the same question yields a deep-equal result across calls", () => {
		const q = question({
			options: [option({ id: "a", label: "A", recommended: true }), option({ id: "b", label: "B" })],
		});
		expect(prepareClarificationOptionSet(q)).toEqual(prepareClarificationOptionSet(q));
	});

	it("does not mutate the input question or its options array", () => {
		const opts = [option({ id: "a", label: "A" })];
		const q = question({ options: opts });
		const frozen = JSON.stringify(q);
		prepareClarificationOptionSet(q);
		expect(JSON.stringify(q)).toBe(frozen);
		expect(q.options).toBe(opts);
		expect(q.options).toHaveLength(1);
	});

	it("tolerates a missing options array (schema default) without throwing", () => {
		const q = question();
		// Simulate a raw object where options was omitted before schema defaulting.
		(q as { options?: NKleinPlanQuestionOption[] }).options = undefined;
		const prepared = prepareClarificationOptionSet(q);
		expect(prepared.options).toHaveLength(4);
		expect(prepared.suppliedCount).toBe(0);
	});
});

describe("meetsClarificationOptionFloor", () => {
	it("is true when the prepared set reached the floor", () => {
		const prepared = prepareClarificationOptionSet(question({ options: [] }));
		expect(meetsClarificationOptionFloor(prepared)).toBe(true);
	});

	it("is false when an over-large floor could not be reached by padding", () => {
		const prepared = prepareClarificationOptionSet(question({ options: [] }), {
			...DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
			minOptions: 99,
		});
		expect(meetsClarificationOptionFloor(prepared, 99)).toBe(false);
	});

	it("uses the default floor when none is passed", () => {
		const prepared = prepareClarificationOptionSet(question({ options: [option({ id: "a", label: "One" })] }), {
			...DEFAULT_CLARIFICATION_OPTION_SET_CONFIG,
			minOptions: 0,
		});
		// Only 1 option (no padding) → below the default floor of 4.
		expect(meetsClarificationOptionFloor(prepared)).toBe(false);
	});
});

// Keep the selection-mode union honest at compile time.
const _modes: ClarificationSelectionMode[] = ["single", "multiple"];
void _modes;
