import { describe, expect, it } from "vitest";

import { findActiveSameTaskModelTurn } from "../../../src/core/model-turn-admission";

describe("findActiveSameTaskModelTurn", () => {
	it("finds a running turn for the same task id", () => {
		const same = { taskId: "card::review", state: "running", modelId: "gemma" };
		expect(
			findActiveSameTaskModelTurn("card::review", [{ taskId: "other", state: "running", modelId: "qwen" }, same]),
		).toBe(same);
	});

	it("ignores non-running same-task summaries", () => {
		expect(
			findActiveSameTaskModelTurn("card::review", [{ taskId: "card::review", state: "awaiting_review" }]),
		).toBeNull();
	});
});
