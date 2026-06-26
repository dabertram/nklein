import { describe, expect, it } from "vitest";
import { detectResponseLoop } from "../../../src/nklein-agent/nklein-response-loop-detection";

describe("detectResponseLoop", () => {
	it("detects a repeated final-message loop and salvages the prefix + one occurrence (grounded: qwen3.5-9b)", () => {
		const unit = "The file hello.txt has been created containing exactly: `Hello from the sandbox.` Let me know! ";
		const text = `Working on it... ${unit.repeat(6)}`;
		const result = detectResponseLoop(text);
		expect(result.looping).toBe(true);
		expect(result.repeats).toBeGreaterThanOrEqual(4);
		// Salvage keeps the lead-in + exactly ONE occurrence of the looped unit.
		expect(result.salvagedText).toBe(`Working on it... ${unit}`.trimEnd());
		expect(result.salvagedText).not.toContain(unit.repeat(2));
	});

	it("leaves natural prose that merely reuses words untouched", () => {
		const text =
			"The plan is to read the file, then run the command, then create a card. The card will summarize the work done.";
		const result = detectResponseLoop(text);
		expect(result.looping).toBe(false);
		expect(result.salvagedText).toBe(text);
	});

	it("does not flag a unit that repeats fewer than minRepeats times", () => {
		const unit = "All steps completed successfully. ";
		const text = unit.repeat(3); // default minRepeats = 4
		expect(detectResponseLoop(text).looping).toBe(false);
		// ...but 4 repeats of the same long unit IS a loop.
		expect(detectResponseLoop(unit.repeat(4)).looping).toBe(true);
	});

	it("requires the repeated run to clear the length floor before flagging", () => {
		// Too little text overall (below minUnitLen * minRepeats) — never a loop, even though it repeats.
		expect(detectResponseLoop("ok ok ok ").looping).toBe(false);
		// A repeated phrase that clears the floor IS a loop.
		expect(detectResponseLoop("processing item... ".repeat(5)).looping).toBe(true);
	});

	it("reports the smallest repeating period, not a multiple", () => {
		const unit = "retrying the operation now; ";
		const result = detectResponseLoop(unit.repeat(8));
		expect(result.looping).toBe(true);
		expect(result.repeatedUnit).toBe(unit.trim());
	});

	it("does not flag a whitespace-only tail and returns the text unchanged when not looping", () => {
		const text = `Here is the answer.${"\n".repeat(20)}`;
		const result = detectResponseLoop(text);
		expect(result.looping).toBe(false);
		expect(result.salvagedText).toBe(text);
	});

	it("respects custom options (lower minRepeats / minUnitLen)", () => {
		const result = detectResponseLoop("Done. Done. Done. ", { minRepeats: 3, minUnitLen: 6 });
		expect(result.looping).toBe(true);
		expect(result.salvagedText).toBe("Done.");
	});
});
