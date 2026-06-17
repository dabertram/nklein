import { describe, expect, it } from "vitest";
import { buildClineAdvisorRequest } from "../../../src/cline-sdk/cline-advisor";

describe("cline advisor", () => {
	it("builds a web-research-backed model freshness request", () => {
		const request = buildClineAdvisorRequest("model_freshness", {
			workspacePath: "/repo",
			modelRegistrySummary: "worker: ollama/qwen3.5-9b, 16k context",
		});

		expect(request).toMatchObject({
			kind: "model_freshness",
			title: "Check For Better Models",
			requiresWebResearch: true,
		});
		expect(request.recommendedSources).toContain("https://openrouter.ai/models");
		expect(request.prompt).toContain("comparable model");
		expect(request.prompt).toContain("worker: ollama/qwen3.5-9b");
		expect(request.prompt).toContain("do not apply changes");
	});

	it("builds MCP discovery requests with trust-signal guidance", () => {
		const request = buildClineAdvisorRequest("mcp_discovery", {
			repoSummary: "React app with GitHub issues workflow",
		});

		expect(request.requiresWebResearch).toBe(true);
		expect(request.recommendedSources).toContain("https://smithery.ai/");
		expect(request.prompt).toContain("trust signals");
		expect(request.prompt).toContain("Never recommend automatic installation");
	});

	it("keeps config and task-failure helpers local by default", () => {
		const config = buildClineAdvisorRequest("config_explainer", {
			runtimeConfigSummary: "auto review enabled, worker role uses local model",
		});
		const failure = buildClineAdvisorRequest("task_failure", {
			taskSummary: "Acceptance check failed with type errors",
		});

		expect(config.requiresWebResearch).toBe(false);
		expect(config.prompt).toContain("context scope");
		expect(failure.requiresWebResearch).toBe(false);
		expect(failure.prompt).toContain("smallest next recovery step");
	});
});
