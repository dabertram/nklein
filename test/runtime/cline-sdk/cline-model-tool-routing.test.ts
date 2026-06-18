import { describe, expect, it } from "vitest";

import { buildKanbanModelToolRoutingRules } from "../../../src/cline-sdk/cline-model-tool-routing";

describe("cline model tool routing", () => {
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
});
