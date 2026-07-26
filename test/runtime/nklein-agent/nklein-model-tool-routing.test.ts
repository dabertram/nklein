import { describe, expect, it } from "vitest";

import {
	buildKanbanModelToolRoutingRules,
	isSimulatorReplayModelId,
	isSmallLocalModelId,
} from "../../../src/nklein-agent/nklein-model-tool-routing";

describe("nklein model tool routing", () => {
	it("trims fragile default tools for small local models", () => {
		const rules = buildKanbanModelToolRoutingRules();

		expect(rules).toEqual([
			expect.objectContaining({
				name: "kanban-small-local-model-tool-trim",
				mode: "any",
				modelIdIncludes: expect.arrayContaining(["qwen", "llama", "mistral"]),
				disableTools: ["fetch_web_content", "skills", "ask_question", "editor"],
			}),
		]);
		expect(rules[0]).not.toHaveProperty("providerIdIncludes");
	});

	it("exempts simulator replay models from capability trims (replay fidelity — N5 sets 01/05)", () => {
		// A `sim/…` model replays a recording; trimming its toolset manufactures unavailable-tool runtime errors
		// the recorded session never had (e.g. `sim/qwen-fast-coder` matching the "qwen" marker lost `editor`).
		expect(isSimulatorReplayModelId("sim/qwen-fast-coder")).toBe(true);
		expect(isSimulatorReplayModelId("qwen2.5-coder-14b")).toBe(false);
		expect(isSmallLocalModelId("sim/qwen-fast-coder")).toBe(false);
		expect(isSmallLocalModelId("qwen2.5-coder-14b")).toBe(true);
		expect(buildKanbanModelToolRoutingRules("sim/qwen-fast-coder")).toEqual([]);
		expect(buildKanbanModelToolRoutingRules("qwen2.5-coder-14b")).toHaveLength(1);
		expect(buildKanbanModelToolRoutingRules()).toHaveLength(1);
	});

	it("keeps strong local models on the default tool surface", () => {
		const rules = buildKanbanModelToolRoutingRules();

		for (const rule of rules) {
			expect(rule.modelIdIncludes).not.toContain("gpt-oss-120b");
			expect(rule.modelIdIncludes).not.toContain("deepseek-r1");
		}
	});
});
