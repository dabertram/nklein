import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildPlanTaskFocusedSpans,
	formatPlanTaskFocusedSpan,
	selectPlanTaskFocusedSpan,
	shouldAttachPlanTaskFocusedSpan,
} from "../../../src/nklein-agent/decomposition/plan-task-focused-spans";
import type { NKleinPlanTask } from "../../../src/nklein-agent/nklein-plan-artifacts";

function task(over: Partial<NKleinPlanTask> = {}): NKleinPlanTask {
	return {
		id: "localize",
		title: "Gate a default flip",
		prompt: "Require a significant paired McNemar improvement before changing the default.",
		dependsOn: [],
		complexity: 40,
		suggestedRole: "worker",
		filesLikelyTouched: ["noise.ts", "decision.ts"],
		acceptanceCommand: "npm test",
		testFirst: false,
		acceptanceTestPrompt: null,
		knowledgeDebt: null,
		...over,
	};
}

describe("F11.2d plan-task focused spans", () => {
	it("selects one bounded top-1 span from the card's likely files", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-focused-span-"));
		await writeFile(
			join(workspacePath, "noise.ts"),
			"export function reportLatency() {\n  return 'tokens per second';\n}\n",
			"utf8",
		);
		await writeFile(
			join(workspacePath, "decision.ts"),
			"export function decideDefaultFlip() {\n  const mcnemar = 'significant paired improvement';\n  return mcnemar;\n}\n",
			"utf8",
		);

		const selected = await selectPlanTaskFocusedSpan({ workspacePath, task: task() });
		expect(selected).toMatchObject({ path: "decision.ts", symbol: "decideDefaultFlip" });
		expect(selected?.content).toContain("significant paired improvement");
		expect(selected?.lineEnd).toBeLessThanOrEqual(48);
	});

	it("fails soft for stale and escaping paths", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-focused-span-missing-"));
		const spans = await buildPlanTaskFocusedSpans({
			workspacePath,
			tasks: [task({ filesLikelyTouched: ["missing.ts", "../outside.ts"] })],
		});
		expect(spans).toEqual({});
	});

	it("formats provenance, line, symbol, and a verify-before-edit warning", () => {
		const formatted = formatPlanTaskFocusedSpan({
			path: "src/a.ts",
			lineStart: 10,
			lineEnd: 12,
			symbol: "target",
			content: "function target() {}",
			score: 16,
		});
		expect(formatted).toContain("automatic top-1 localization; verify before editing");
		expect(formatted).toContain("Path: src/a.ts:10");
		expect(formatted).toContain("Symbol: target");
	});

	it("spends pushed-span tokens only below the measured capability ceiling", () => {
		const candidate = (capability: number) => ({ entry: { capability: { effectiveScore: capability } } }) as never;
		expect(shouldAttachPlanTaskFocusedSpan(undefined)).toBe(true);
		expect(shouldAttachPlanTaskFocusedSpan(null)).toBe(true);
		expect(shouldAttachPlanTaskFocusedSpan(candidate(90))).toBe(true);
		expect(shouldAttachPlanTaskFocusedSpan(candidate(91))).toBe(false);
	});
});
