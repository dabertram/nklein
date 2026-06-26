import { describe, expect, it } from "vitest";

import { buildKanbanModelToolRoutingRules } from "../../../src/nklein-agent/nklein-model-tool-routing";

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

	it("keeps strong local models on the default tool surface", () => {
		const rules = buildKanbanModelToolRoutingRules();

		for (const rule of rules) {
			expect(rule.modelIdIncludes).not.toContain("gpt-oss-120b");
			expect(rule.modelIdIncludes).not.toContain("deepseek-r1");
		}
	});
});
