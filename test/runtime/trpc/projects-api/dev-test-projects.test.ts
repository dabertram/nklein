import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/nklein-agent/dev-test-project-registry", () => ({
	loadDevTestProjectRegistry: vi.fn(() => [
		{ config: { id: "a", title: "A", tier: 1, tags: ["x"], complexity: "low" } },
		{ config: { id: "b", title: "B" } },
	]),
}));

import { handleListDevTestProjects } from "../../../../src/trpc/projects-api/dev-test-projects";

describe("handleListDevTestProjects", () => {
	it("projects registry entries to the wire shape, including tier/tags/complexity only when present", () => {
		const result = handleListDevTestProjects();
		expect(result.entries).toEqual([
			{ id: "a", title: "A", tier: 1, tags: ["x"], complexity: "low" },
			{ id: "b", title: "B" },
		]);
	});
});
