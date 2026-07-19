import { describe, expect, it } from "vitest";
import {
	assessTestMisinterpretation,
	isTestFilePath,
	type TestMisinterpretationEvent,
} from "../../src/core/test-misinterpretation-detector";

describe("test-misinterpretation detector (F12.15b)", () => {
	it("classifies test paths by directory and suffix conventions", () => {
		expect(isTestFilePath("src/foo.test.ts")).toBe(true);
		expect(isTestFilePath("tests/habit.spec.jsx")).toBe(true);
		expect(isTestFilePath("packages/app/__tests__/util.js")).toBe(true);
		expect(isTestFilePath("src/foo.ts")).toBe(false);
		expect(isTestFilePath("src/latest-run.ts")).toBe(false);
	});

	it("flags a red run followed by test-file-only edits", () => {
		const events: TestMisinterpretationEvent[] = [
			{ kind: "edit", path: "src/score.ts" },
			{ kind: "red_run" },
			{ kind: "edit", path: "test/score.test.ts" },
			{ kind: "edit", path: "src/__tests__/other.test.ts" },
		];
		const verdict = assessTestMisinterpretation(events);
		expect(verdict.flagged).toBe(true);
		expect(verdict.testEditCount).toBe(2);
	});

	it("stays quiet when implementation files are edited after the red run", () => {
		const events: TestMisinterpretationEvent[] = [
			{ kind: "red_run" },
			{ kind: "edit", path: "test/score.test.ts" },
			{ kind: "edit", path: "src/score.ts" },
		];
		expect(assessTestMisinterpretation(events).flagged).toBe(false);
	});

	it("stays quiet with no red run or too-thin evidence", () => {
		expect(assessTestMisinterpretation([{ kind: "edit", path: "test/a.test.ts" }]).flagged).toBe(false);
		expect(assessTestMisinterpretation([{ kind: "red_run" }, { kind: "edit", path: "test/a.test.ts" }]).flagged).toBe(
			false,
		);
	});

	it("assesses only the LATEST red run (a later green fix flow resets the story)", () => {
		const events: TestMisinterpretationEvent[] = [
			{ kind: "red_run" },
			{ kind: "edit", path: "test/a.test.ts" },
			{ kind: "edit", path: "test/b.test.ts" },
			{ kind: "red_run" },
			{ kind: "edit", path: "src/fix.ts" },
			{ kind: "edit", path: "test/a.test.ts" },
		];
		expect(assessTestMisinterpretation(events).flagged).toBe(false);
	});
});
