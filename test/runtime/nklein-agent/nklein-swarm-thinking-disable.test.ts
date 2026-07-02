import { describe, expect, it } from "vitest";
import { shouldDisableSwarmThinking } from "../../../src/nklein-agent/nklein-task-start-guard";

describe("shouldDisableSwarmThinking (W1.3 — kill the reasoning tax on trivial swarm cards)", () => {
	it("disables thinking for a trivial card on a switchable model (qwen3)", () => {
		expect(
			shouldDisableSwarmThinking({ modelId: "qwen/qwen3-8b", prompt: "Add a friendly greeting to the CLI banner." }),
		).toBe(true);
	});

	it("keeps thinking for a HARD card on the same switchable model (reasoning helps there)", () => {
		expect(
			shouldDisableSwarmThinking({
				modelId: "qwen/qwen3-8b",
				prompt: "Refactor the scheduler to remove the race condition in concurrent lease renewal.",
			}),
		).toBe(false);
	});

	it("never fires for a non-switchable family (qwen3.5 ignores /no_think — W1.1 budget-raise owns those)", () => {
		expect(
			shouldDisableSwarmThinking({ modelId: "qwen3.5-9b-mlx", prompt: "Add a friendly greeting to the banner." }),
		).toBe(false);
	});

	it("never fires without a model id", () => {
		expect(shouldDisableSwarmThinking({ modelId: null, prompt: "trivial" })).toBe(false);
	});
});
