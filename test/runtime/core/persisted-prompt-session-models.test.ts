import { describe, expect, it } from "vitest";
import {
	collectPersistedPromptSessionModelIds,
	extractPersistedPromptSessionModel,
} from "../../../src/core/persisted-prompt-session-models";

describe("persisted prompt session model extraction", () => {
	it("extracts snake_case prompt session records from the CLI session store", () => {
		expect(
			extractPersistedPromptSessionModel({
				session_id: "habit-insights-classify-trends__review-123",
				model: "qwopus3.5-9b-coder-mtp",
			}),
		).toEqual({
			sessionId: "habit-insights-classify-trends__review-123",
			modelId: "qwopus3.5-9b-coder-mtp",
		});
	});

	it("extracts camelCase prompt session records", () => {
		expect(
			extractPersistedPromptSessionModel({
				sessionId: "task-1::review",
				modelId: "qwen/qwen3-8b",
			}),
		).toEqual({ sessionId: "task-1::review", modelId: "qwen/qwen3-8b" });
	});

	it("ignores records without a concrete session and model", () => {
		expect(extractPersistedPromptSessionModel({ session_id: "task-1" })).toBeNull();
		expect(extractPersistedPromptSessionModel({ model: "qwen/qwen3-8b" })).toBeNull();
		expect(extractPersistedPromptSessionModel(null)).toBeNull();
	});

	it("collects unique model ids across persisted records", () => {
		const modelIds = collectPersistedPromptSessionModelIds([
			{ session_id: "worker-1", model: "mistralai/devstral-small-2-2512" },
			{ session_id: "worker-2", model: "mistralai/devstral-small-2-2512" },
			{ session_id: "worker-1::review", model: "qwopus3.5-9b-coder-mtp" },
			{ session_id: "invalid" },
		]);

		expect([...modelIds].sort()).toEqual(["mistralai/devstral-small-2-2512", "qwopus3.5-9b-coder-mtp"]);
	});
});
