import { describe, expect, it } from "vitest";
import { type IntentSelectableComponent, selectPromptComponentsForIntent } from "../../../src/core/prompt-intent-mode";

interface Frag extends IntentSelectableComponent {
	id: string;
}

const fragments: Frag[] = [
	{ id: "safety", invariant: true, tier: "enriching" }, // invariant → always, despite the low tier
	{ id: "task", tier: "essential" },
	{ id: "acceptance", tier: "standard" },
	{ id: "examples", tier: "enriching" },
];

describe("selectPromptComponentsForIntent (F4.39)", () => {
	it("minimize keeps invariants + essentials only", () => {
		expect(selectPromptComponentsForIntent(fragments, "minimize").map((f) => f.id)).toEqual(["safety", "task"]);
	});

	it("balance adds standard-tier components", () => {
		expect(selectPromptComponentsForIntent(fragments, "balance").map((f) => f.id)).toEqual([
			"safety",
			"task",
			"acceptance",
		]);
	});

	it("max_task_info keeps everything", () => {
		expect(selectPromptComponentsForIntent(fragments, "max_task_info").map((f) => f.id)).toEqual([
			"safety",
			"task",
			"acceptance",
			"examples",
		]);
	});

	it("never drops an invariant even in minimize, and preserves input order", () => {
		const withLateInvariant: Frag[] = [
			{ id: "a", tier: "enriching" },
			{ id: "guard", invariant: true, tier: "enriching" },
			{ id: "b", tier: "essential" },
		];
		expect(selectPromptComponentsForIntent(withLateInvariant, "minimize").map((f) => f.id)).toEqual(["guard", "b"]);
	});
});
