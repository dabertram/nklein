import { describe, expect, it, vi } from "vitest";
import {
	createNKleinMergeResolutionTool,
	nkleinMergeResolutionSubmissionSchema,
} from "../../../src/nklein-agent/nklein-merge-resolution-tool";

describe("submit_merge_resolution (§5.AK Phase B merge agent)", () => {
	it("delivers a resolved outcome and tells the agent to stop", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinMergeResolutionTool({ onSubmitted });
		const result = (await tool.execute?.(
			{ outcome: "resolved", summary: "Kept both intents in src/app.ts." },
			{} as never,
		)) as {
			ok: boolean;
			outcome: string;
			instruction: string;
		};
		expect(result.ok).toBe(true);
		expect(result.outcome).toBe("resolved");
		expect(result.instruction).toContain("Stop now");
		expect(onSubmitted).toHaveBeenCalledWith({
			outcome: "resolved",
			summary: "Kept both intents in src/app.ts.",
			reason: null,
		});
	});

	it("requires a reason for a cannot_resolve outcome (Zod refine)", () => {
		expect(() =>
			nkleinMergeResolutionSubmissionSchema.parse({ outcome: "cannot_resolve", summary: "Stuck." }),
		).toThrow(/reason is required/);
		expect(
			nkleinMergeResolutionSubmissionSchema.parse({
				outcome: "cannot_resolve",
				summary: "Stuck.",
				reason: "Both sides rewrote the same function with incompatible signatures.",
			}).reason,
		).toContain("incompatible signatures");
	});

	it("tolerates explicit nulls on resolved exactly like submit_plan_critique learned to (#15)", async () => {
		const tool = createNKleinMergeResolutionTool({});
		// The JSON schema advertises ["string","null"] so the SDK never pre-rejects; the Zod layer accepts null.
		const schema = tool.inputSchema as { properties: { reason: { type: unknown } } };
		expect(schema.properties.reason.type).toEqual(["string", "null"]);
		const parsed = nkleinMergeResolutionSubmissionSchema.parse({
			outcome: "resolved",
			summary: "Done.",
			reason: null,
		});
		expect(parsed.reason).toBeNull();
	});

	it("trims and null-coalesces whitespace-only reasons", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinMergeResolutionTool({ onSubmitted });
		await tool.execute?.({ outcome: "resolved", summary: "  ok  ", reason: "   " }, {} as never);
		expect(onSubmitted).toHaveBeenCalledWith({ outcome: "resolved", summary: "ok", reason: null });
	});
});
