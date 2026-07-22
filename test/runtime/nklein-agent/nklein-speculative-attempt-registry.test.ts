import { describe, expect, it } from "vitest";
import { SpeculativeAttemptRegistry } from "../../../src/nklein-agent/nklein-speculative-attempt-registry";

describe("SpeculativeAttemptRegistry", () => {
	it("keeps a launched attempt active until its owning promise settles", () => {
		const registry = new SpeculativeAttemptRegistry();
		registry.begin("workspace-a", "card-b");
		registry.begin("workspace-a", "card-a");

		// No task-summary input exists here by design: a projected idle/review state cannot hide owned work.
		expect(registry.list("workspace-a")).toEqual(["card-a", "card-b"]);
		expect(registry.count("workspace-a")).toBe(2);

		registry.end("workspace-a", "card-a");
		expect(registry.list("workspace-a")).toEqual(["card-b"]);
	});

	it("isolates and clears workspace lifecycles", () => {
		const registry = new SpeculativeAttemptRegistry();
		registry.begin("workspace-a", "same-card");
		registry.begin("workspace-b", "same-card");
		registry.clearWorkspace("workspace-a");

		expect(registry.list("workspace-a")).toEqual([]);
		expect(registry.list("workspace-b")).toEqual(["same-card"]);
	});
});
