import { describe, expect, it } from "vitest";
import { KANBAN_TASK_TOOL_CARDS } from "../../../src/core/task-tool-cards";
import { buildTwoPhaseToolMenuReport } from "../../../src/nklein-agent/nklein-two-phase-tool-menu-report";

describe("buildTwoPhaseToolMenuReport", () => {
	it("reports every offered tool and a positive token footprint", () => {
		const report = buildTwoPhaseToolMenuReport();
		expect(report.toolCount).toBe(KANBAN_TASK_TOOL_CARDS.length);
		expect(report.menuTokens).toBeGreaterThan(0);
		for (const card of KANBAN_TASK_TOOL_CARDS) {
			expect(report.menu).toContain(card.name);
		}
	});

	it("teaches the canonical none / plan answers in the menu", () => {
		const report = buildTwoPhaseToolMenuReport();
		expect(report.menu).toContain('"none"');
		expect(report.menu).toContain('"plan"');
	});
});
