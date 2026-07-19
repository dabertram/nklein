import { describe, expect, it, vi } from "vitest";
import {
	buildArchitectSeedPrompt,
	createNKleinArchitectBriefTool,
} from "../../../src/nklein-agent/nklein-architect-tool";
import type { AgentToolContext } from "../../../src/nklein-agent/sdk-agent-types";

const toolContext = {} as AgentToolContext;

describe("F12.62 architect tool", () => {
	it("seed prompt carries the pure-core architect contract plus the tool-call submission clause", () => {
		const seed = buildArchitectSeedPrompt("Fix the pager off-by-one");
		expect(seed).toContain("ARCHITECT");
		expect(seed).toContain("IMPLEMENTATION BRIEF");
		expect(seed).toContain("submit_implementation_brief");
		expect(seed).toContain("Fix the pager off-by-one");
	});

	it("accepts a real brief exactly once and rejects junk with an actionable error", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinArchitectBriefTool({ onSubmitted });
		const ok = await tool.execute({ brief: "1. pager.ts limit(): change < to <= at the loop bound." }, toolContext);
		expect(ok).toMatchObject({ ok: true });
		expect(onSubmitted).toHaveBeenCalledWith("1. pager.ts limit(): change < to <= at the loop bound.");

		const bad = await tool.execute({ brief: "short" }, toolContext);
		expect(bad).toHaveProperty("error");
		expect(onSubmitted).toHaveBeenCalledTimes(1);
	});
});
