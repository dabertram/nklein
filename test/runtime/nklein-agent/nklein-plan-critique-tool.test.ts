import { describe, expect, it, vi } from "vitest";
import {
	createNKleinPlanCritiqueTool,
	nkleinPlanCritiqueSubmissionSchema,
} from "../../../src/nklein-agent/nklein-plan-critique-tool";

describe("submit_plan_critique (W4.3 decompose-critique)", () => {
	it("delivers a proceed verdict and tells the critic to stop", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinPlanCritiqueTool({ onSubmitted });
		const result = (await tool.execute?.({ verdict: "proceed", summary: "Plan is coherent." }, {} as never)) as {
			ok: boolean;
			verdict: string;
			instruction: string;
		};
		expect(result.ok).toBe(true);
		expect(result.verdict).toBe("proceed");
		expect(result.instruction).toContain("Stop now");
		expect(onSubmitted).toHaveBeenCalledWith({ verdict: "proceed", summary: "Plan is coherent.", feedback: null });
	});

	it("requires feedback for a revise verdict (Zod refine)", () => {
		expect(() => nkleinPlanCritiqueSubmissionSchema.parse({ verdict: "revise", summary: "Gaps." })).toThrow(
			/feedback is required/,
		);
		expect(
			nkleinPlanCritiqueSubmissionSchema.parse({
				verdict: "revise",
				summary: "Gaps.",
				feedback: "Split the god-card into per-module tasks.",
			}).feedback,
		).toContain("god-card");
	});

	it("tolerates explicit nulls on proceed exactly like submit_review learned to (#15)", async () => {
		const tool = createNKleinPlanCritiqueTool({});
		// The JSON schema advertises ["string","null"] so the SDK never pre-rejects; the Zod layer accepts null.
		const schema = tool.inputSchema as { properties: { feedback: { type: unknown } } };
		expect(schema.properties.feedback.type).toEqual(["string", "null"]);
		const parsed = nkleinPlanCritiqueSubmissionSchema.parse({
			verdict: "proceed",
			summary: "Fine.",
			feedback: null,
		});
		expect(parsed.feedback).toBeNull();
	});

	it("trims and null-coalesces whitespace-only feedback", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinPlanCritiqueTool({ onSubmitted });
		await tool.execute?.({ verdict: "proceed", summary: "  ok  ", feedback: "   " }, {} as never);
		expect(onSubmitted).toHaveBeenCalledWith({ verdict: "proceed", summary: "ok", feedback: null });
	});
});
