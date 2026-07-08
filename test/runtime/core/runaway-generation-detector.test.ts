import { describe, expect, it } from "vitest";
import { detectRunawayGeneration, findPeriodicTailCycle } from "../../../src/core/runaway-generation-detector";

describe("findPeriodicTailCycle", () => {
	it("reports a single-char run with period 1 (smallest period wins)", () => {
		const cycle = findPeriodicTailCycle(`prefix ${"a".repeat(300)}`, 120, 200, 3);
		expect(cycle?.period).toBe(1);
		expect(cycle?.unit).toBe("a");
		expect(cycle?.repeats).toBeGreaterThanOrEqual(3);
	});

	it("reports a repeated line with its full period", () => {
		const line = "the answer is 42.\n"; // 18 chars
		const cycle = findPeriodicTailCycle(line.repeat(20), 120, 200, 3);
		expect(cycle?.period).toBe(line.length);
		expect(cycle?.unit).toBe(line);
	});

	it("returns null when the tail is not degenerately repetitive", () => {
		const prose = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.";
		expect(findPeriodicTailCycle(prose, 120, 200, 3)).toBeNull();
	});

	it("returns null when the repeat is too short to matter (span below minimum)", () => {
		// "ab" x 5 = 10 chars — well below a 200-char span minimum.
		expect(findPeriodicTailCycle("prefix abababababab", 120, 200, 3)).toBeNull();
	});
});

describe("detectRunawayGeneration", () => {
	it("does not judge text shorter than the min-before-judging threshold", () => {
		expect(detectRunawayGeneration("no ".repeat(20)).runaway).toBe(false); // 60 chars < 400
	});

	it("flags a looping tail as repetition", () => {
		const text = `Here is my plan.\n${"- retry the step\n".repeat(60)}`;
		const verdict = detectRunawayGeneration(text);
		expect(verdict.runaway).toBe(true);
		expect(verdict.reason).toBe("repetition");
		expect(verdict.detail).toMatch(/looping tail/);
	});

	it("flags an unbounded wall of non-repetitive text via the length ceiling", () => {
		// Build long, NON-repetitive text so only the length ceiling (not repetition) trips.
		let text = "";
		for (let i = 0; text.length <= 25000; i++) {
			text += `sentence number ${i} about a distinct topic ${(i * 7919) % 100000}. `;
		}
		const verdict = detectRunawayGeneration(text);
		expect(verdict.runaway).toBe(true);
		expect(verdict.reason).toBe("length_ceiling");
	});

	it("does NOT flag a long BUT non-repetitive generation under the ceiling (slow-but-legitimate)", () => {
		let text = "";
		for (let i = 0; text.length < 5000; i++) {
			text += `step ${i}: compute the distinct value ${(i * 104729) % 99991} and move on. `;
		}
		expect(text.length).toBeGreaterThan(400);
		expect(text.length).toBeLessThan(24000);
		expect(detectRunawayGeneration(text).runaway).toBe(false);
	});

	it("respects custom thresholds", () => {
		// Non-repetitive content (distinct number each clause) so ONLY the lowered length ceiling can trip it.
		let text = "";
		for (let i = 0; text.length < 600; i++) {
			text += `note ${(i * 7919) % 100000} `;
		}
		const verdict = detectRunawayGeneration(text, { maxChars: 100 });
		expect(verdict.runaway).toBe(true);
		expect(verdict.reason).toBe("length_ceiling");
	});

	it("includes a trimmed unit preview in the repetition detail", () => {
		const verdict = detectRunawayGeneration("intro\n".concat("ERROR: cannot proceed here \n".repeat(50)));
		expect(verdict.detail).toMatch(/ERROR: cannot proceed/);
	});
});
