import { describe, expect, it } from "vitest";
import { createNKleinReviewTool, type NKleinReviewResult } from "../../../src/nklein-agent/nklein-review-tool";

async function run(input: unknown): Promise<{ result: NKleinReviewResult | null; output: unknown }> {
	let captured: NKleinReviewResult | null = null;
	const tool = createNKleinReviewTool({
		onSubmitted: (result) => {
			captured = result;
		},
	});
	const output = await tool.execute(input, undefined as never);
	return { result: captured, output };
}

describe("submit_review tool", () => {
	it("accepts an approval without feedback and fires the callback", async () => {
		const { result, output } = await run({ verdict: "approve", summary: "Looks correct; tests cover the change." });
		expect(result).toMatchObject({ verdict: "approve", feedback: null });
		expect(output).toMatchObject({ ok: true, verdict: "approve" });
	});

	it("records optional insight on approval", async () => {
		const { result } = await run({
			verdict: "approve",
			summary: "Good.",
			insight: "Nice use of the timebase primitive.",
		});
		expect(result?.insight).toBe("Nice use of the timebase primitive.");
	});

	it("§5.AW: defaults preferred to null on an ordinary single-candidate review", async () => {
		const { result } = await run({ verdict: "approve", summary: "Fine." });
		expect(result?.preferred).toBeNull();
	});

	it("§5.AW: records the reviewer's A/B pick and tolerates an explicit null", async () => {
		const picked = await run({ verdict: "approve", summary: "B is more correct.", preferred: "speculative" });
		expect(picked.result?.preferred).toBe("speculative");
		const nulled = await run({ verdict: "approve", summary: "Fine.", preferred: null });
		expect(nulled.result?.preferred).toBeNull();
	});

	it("#32 (run34): tolerates off-vocabulary preferred values instead of pre-rejecting the verdict", async () => {
		// A reviewer on an ORDINARY review filled the field anyway; the strict enum rejected the whole verdict
		// 4x and the abandoned reviewer's no-verdict hold froze a 1-wide rail. Junk now means "no preference".
		const junk = await run({ verdict: "approve", summary: "Fine.", preferred: "not-applicable" });
		expect(junk.result?.preferred).toBeNull();
		const spellings = await run({ verdict: "approve", summary: "B wins.", preferred: "Candidate B" });
		expect(spellings.result?.preferred).toBe("speculative");
		const letter = await run({ verdict: "approve", summary: "A wins.", preferred: "A" });
		expect(letter.result?.preferred).toBe("primary");
	});

	it("accepts request_changes with feedback", async () => {
		const { result } = await run({
			verdict: "request_changes",
			summary: "Edge case missing.",
			feedback: "Handle the zero-length buffer in render().",
		});
		expect(result).toMatchObject({
			verdict: "request_changes",
			feedback: "Handle the zero-length buffer in render().",
		});
	});

	it("rejects request_changes without feedback", async () => {
		const tool = createNKleinReviewTool({});
		await expect(
			tool.execute({ verdict: "request_changes", summary: "Needs work." }, undefined as never),
		).rejects.toThrow(/feedback is required/i);
	});

	it("rejects an unknown verdict", async () => {
		const tool = createNKleinReviewTool({});
		await expect(tool.execute({ verdict: "maybe", summary: "x" }, undefined as never)).rejects.toThrow();
	});

	it("treats blank feedback as missing for request_changes", async () => {
		const tool = createNKleinReviewTool({});
		await expect(
			tool.execute({ verdict: "request_changes", summary: "x", feedback: "   " }, undefined as never),
		).rejects.toThrow(/feedback is required/i);
	});
});
