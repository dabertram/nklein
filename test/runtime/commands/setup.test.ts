import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerSetupCommand, renderSetupPlanText } from "../../../src/commands/setup";
import type { RuntimeSetupPlanResponse } from "../../../src/core/config-api-contract";

const globalPlan: RuntimeSetupPlanResponse = {
	kind: "global",
	completedAt: null,
	steps: [
		{
			stepId: "sandbox",
			title: "Docker sandbox",
			recommendation: "Strict isolation is ready.",
			detail: "Every task action stays in Docker.",
		},
	],
};

const projectPlan: RuntimeSetupPlanResponse = {
	kind: "project",
	completedAt: 1_700_000_000_000,
	steps: [
		{
			stepId: "egress",
			title: "Egress & retrieval (inherited)",
			recommendation: "Fully local.",
			detail: "The project cannot widen the runtime boundary.",
		},
	],
};

describe("setup CLI rendering (F5.3)", () => {
	it("renders the setup-plan model as readable numbered terminal output", () => {
		const rendered = renderSetupPlanText(projectPlan, "/repo");
		expect(rendered).toContain("!Klein project setup — /repo");
		expect(rendered).toContain("last completed 2023-11-14T22:13:20.000Z");
		expect(rendered).toContain("1. Egress & retrieval (inherited) [egress]");
		expect(rendered).toContain("The project cannot widen");
	});

	it("registers `setup` and emits exact JSON parity for automation", async () => {
		const program = new Command();
		const write = vi.fn();
		const buildPlans = vi.fn(async () => [globalPlan, projectPlan]);
		registerSetupCommand(program, { buildPlans, write, cwd: () => "/repo" });

		await program.parseAsync(["setup", "--scope", "all", "--json"], { from: "user" });

		expect(buildPlans).toHaveBeenCalledWith({ projectPath: "/repo", scope: "all" });
		expect(JSON.parse(write.mock.calls[0]?.[0] ?? "null")).toEqual([globalPlan, projectPlan]);
	});

	it("rejects an unknown scope instead of silently rendering the wrong plan", async () => {
		const program = new Command();
		registerSetupCommand(program, { buildPlans: vi.fn(), write: vi.fn(), cwd: () => "/repo" });
		await expect(program.parseAsync(["setup", "--scope", "fleet"], { from: "user" })).rejects.toThrow(
			/Expected all, global, or project/,
		);
	});
});
