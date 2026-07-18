import { describe, expect, it } from "vitest";
import {
	applyJudgeSessionPromptDiet,
	complexityNeedLevel,
	JUDGE_MINIMAL_BASE_PROMPT,
	JUDGE_SESSION_KINDS,
	resolveSysPromptComponents,
	SYSPROMPT_LEVEL_COMPONENTS,
	SYSPROMPT_LEVELS,
	type SysPromptLevel,
	type SysPromptMode,
	selectSysPromptLevel,
	windowCapLevel,
} from "../../../src/core/sysprompt-level";

describe("SYSPROMPT_LEVELS / component table", () => {
	it("orders the five levels leanest → richest", () => {
		expect(SYSPROMPT_LEVELS).toEqual(["minimal", "lean", "balanced", "full", "max"]);
	});

	it("is STRICTLY ADDITIVE: each level's components ⊇ the level below (all adjacent pairs)", () => {
		for (let i = 1; i < SYSPROMPT_LEVELS.length; i++) {
			const lower = new Set(SYSPROMPT_LEVEL_COMPONENTS[SYSPROMPT_LEVELS[i - 1]]);
			const higher = SYSPROMPT_LEVEL_COMPONENTS[SYSPROMPT_LEVELS[i]];
			const higherSet = new Set(higher);
			// superset: every lower component is present in the higher level
			for (const c of lower) {
				expect(higherSet.has(c)).toBe(true);
			}
			// strictly additive: the higher level adds at least one NEW component
			expect(higher.length).toBeGreaterThan(lower.size);
		}
	});

	it("has no duplicate components within any level", () => {
		for (const level of SYSPROMPT_LEVELS) {
			const components = SYSPROMPT_LEVEL_COMPONENTS[level];
			expect(new Set(components).size).toBe(components.length);
		}
	});

	it("pins the minimal core and the max additions (load-bearing content: minimal ≠ short)", () => {
		expect(SYSPROMPT_LEVEL_COMPONENTS.minimal).toEqual(["identity", "safety_rules", "tool_names"]);
		expect(SYSPROMPT_LEVEL_COMPONENTS.max).toEqual(
			expect.arrayContaining(["extended_thinking", "self_critique", "domain_skill_bodies"]),
		);
		// the irreducible core survives at EVERY level
		for (const level of SYSPROMPT_LEVELS) {
			expect(SYSPROMPT_LEVEL_COMPONENTS[level]).toEqual(
				expect.arrayContaining(["identity", "safety_rules", "tool_names"]),
			);
		}
	});
});

describe("resolveSysPromptComponents", () => {
	it("returns the level's component set", () => {
		expect(resolveSysPromptComponents("lean")).toEqual([
			"identity",
			"safety_rules",
			"tool_names",
			"output_contract",
			"tool_descriptions",
		]);
	});

	it("returns a fresh array (mutating the result does not corrupt the table)", () => {
		const lengthBefore = SYSPROMPT_LEVEL_COMPONENTS.balanced.length;
		const a = resolveSysPromptComponents("balanced");
		a.push("identity"); // duplicate it — a leak would show up as a longer table entry
		// the table entry is untouched: same length, and a fresh resolve does not see the pushed element
		expect(SYSPROMPT_LEVEL_COMPONENTS.balanced.length).toBe(lengthBefore);
		expect(resolveSysPromptComponents("balanced").length).toBe(lengthBefore);
		// the two resolved arrays are distinct instances
		expect(resolveSysPromptComponents("balanced")).not.toBe(resolveSysPromptComponents("balanced"));
	});
});

describe("windowCapLevel — thresholds incl. boundaries", () => {
	it("maps tiny windows to minimal (< 2000)", () => {
		expect(windowCapLevel(0)).toBe("minimal");
		expect(windowCapLevel(1999)).toBe("minimal");
	});

	it("treats the boundaries as exclusive upper bounds (8000, 32000, 128000)", () => {
		expect(windowCapLevel(2000)).toBe("lean");
		expect(windowCapLevel(7999)).toBe("lean");
		expect(windowCapLevel(8000)).toBe("balanced"); // boundary → next tier up
		expect(windowCapLevel(31999)).toBe("balanced");
		expect(windowCapLevel(32000)).toBe("full"); // boundary → next tier up
		expect(windowCapLevel(127999)).toBe("full");
		expect(windowCapLevel(128000)).toBe("max"); // boundary → next tier up
		expect(windowCapLevel(1_000_000)).toBe("max");
	});
});

describe("complexityNeedLevel", () => {
	it("maps each complexity to its warranted depth", () => {
		expect(complexityNeedLevel("trivial")).toBe("minimal");
		expect(complexityNeedLevel("standard")).toBe("balanced");
		expect(complexityNeedLevel("complex")).toBe("full");
		expect(complexityNeedLevel("novel")).toBe("max");
	});
});

describe("selectSysPromptLevel — base = min(windowCap, complexityNeed)", () => {
	it("caps a complex task to the WINDOW when the window is small (8k window → lean cap)", () => {
		// complex wants `full`, but a 7000-tok window only affords `lean` → base lean, balance keeps it.
		expect(selectSysPromptLevel({ availableContextTokens: 7000, taskComplexity: "complex", mode: "balance" })).toBe(
			"lean",
		);
	});

	it("caps to the TASK when the window is huge (trivial task on a 200k window → minimal)", () => {
		// window affords `max`, but trivial only needs `minimal` → base minimal.
		expect(
			selectSysPromptLevel({ availableContextTokens: 200_000, taskComplexity: "trivial", mode: "balance" }),
		).toBe("minimal");
	});

	it("uses the richer end only when BOTH window and task allow (novel on 200k → max)", () => {
		expect(selectSysPromptLevel({ availableContextTokens: 200_000, taskComplexity: "novel", mode: "balance" })).toBe(
			"max",
		);
	});

	it("lands on balanced for a standard task with ample window (balance mode)", () => {
		// window affords `full` (64k), standard needs `balanced` → min = balanced.
		expect(
			selectSysPromptLevel({ availableContextTokens: 64_000, taskComplexity: "standard", mode: "balance" }),
		).toBe("balanced");
	});
});

describe("selectSysPromptLevel — intent-mode bias", () => {
	it("minimize and max_task_info both step DOWN one level from base; balance is unchanged", () => {
		// base = min(full window=64k, complex task=full) = full
		const ctx = { availableContextTokens: 64_000, taskComplexity: "complex" } as const;
		expect(selectSysPromptLevel({ ...ctx, mode: "balance" })).toBe("full");
		expect(selectSysPromptLevel({ ...ctx, mode: "minimize" })).toBe("balanced"); // full → balanced
		expect(selectSysPromptLevel({ ...ctx, mode: "max_task_info" })).toBe("balanced"); // same one-step-down
	});

	it("clamps the step-down at minimal (cannot go below the irreducible core)", () => {
		// base = min(any window, trivial=minimal) = minimal; stepping down stays minimal.
		const ctx = { availableContextTokens: 200_000, taskComplexity: "trivial" } as const;
		for (const mode of ["minimize", "max_task_info"] as SysPromptMode[]) {
			expect(selectSysPromptLevel({ ...ctx, mode })).toBe("minimal");
		}
	});

	it("never exceeds the window cap after biasing (defensive sweep over windows × complexities × modes)", () => {
		const windows = [1500, 2000, 7999, 8000, 31999, 32000, 127999, 128000, 500_000];
		const complexities = ["trivial", "standard", "complex", "novel"] as const;
		const modes: SysPromptMode[] = ["minimize", "balance", "max_task_info"];
		const ord = (l: SysPromptLevel) => SYSPROMPT_LEVELS.indexOf(l);
		for (const availableContextTokens of windows) {
			const cap = windowCapLevel(availableContextTokens);
			for (const taskComplexity of complexities) {
				for (const mode of modes) {
					const chosen = selectSysPromptLevel({ availableContextTokens, taskComplexity, mode });
					expect(ord(chosen)).toBeLessThanOrEqual(ord(cap));
				}
			}
		}
	});
});
describe("judge-session prompt diet (F4.37 first consumer)", () => {
	it("swaps the worker shell for the static minimal judge base and drops worker-only sections", () => {
		const dieted = applyJudgeSessionPromptDiet({
			basePrompt: "x".repeat(20_000),
			baseIsStaticShell: false,
			efficiencyRules: "lean rules",
			planningPrompt: "plan",
			attemptRetryNote: "retry",
			skillFragments: [{ id: "s1" }],
		});
		expect(dieted.basePrompt).toBe(JUDGE_MINIMAL_BASE_PROMPT);
		expect(dieted.basePrompt.length).toBeLessThan(1_000);
		expect(dieted.baseIsStaticShell).toBe(true);
		expect(dieted.efficiencyRules).toBe("");
		expect(dieted.planningPrompt).toBeNull();
		expect(dieted.attemptRetryNote).toBeNull();
		expect(dieted.skillFragments).toEqual([]);
		expect(JUDGE_MINIMAL_BASE_PROMPT).toContain("submit");
	});

	it("names the judge kinds", () => {
		expect(JUDGE_SESSION_KINDS.has("review")).toBe(true);
		expect(JUDGE_SESSION_KINDS.has("plan-critique")).toBe(true);
		expect(JUDGE_SESSION_KINDS.has("merge")).toBe(true);
		expect(JUDGE_SESSION_KINDS.has("worker")).toBe(false);
	});
});
