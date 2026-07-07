import { describe, expect, it } from "vitest";
import {
	isDerivedTaskSessionId,
	isSpeculativeMirrorTaskId,
	primaryTaskIdOfSpeculativeMirror,
} from "../../../src/core/synthetic-task-id";

describe("isDerivedTaskSessionId", () => {
	it("is true for any '::'-suffixed derived session (spec, review, plan-critique, acceptance)", () => {
		for (const suffix of ["spec", "review", "plan-critique", "acceptance"]) {
			expect(isDerivedTaskSessionId(`card-7::${suffix}`)).toBe(true);
		}
	});

	it("is false for a primary work-card id", () => {
		expect(isDerivedTaskSessionId("card-7")).toBe(false);
		expect(isDerivedTaskSessionId("build-the-widget")).toBe(false);
	});
});

describe("isSpeculativeMirrorTaskId", () => {
	it("is true only for the '::spec' suffix, not other derived kinds", () => {
		expect(isSpeculativeMirrorTaskId("card-7::spec")).toBe(true);
		expect(isSpeculativeMirrorTaskId("card-7::review")).toBe(false);
		expect(isSpeculativeMirrorTaskId("card-7")).toBe(false);
	});
});

describe("primaryTaskIdOfSpeculativeMirror", () => {
	it("strips the '::spec' suffix to recover the shadowed primary card id", () => {
		expect(primaryTaskIdOfSpeculativeMirror("card-7::spec")).toBe("card-7");
	});

	it("is a no-op for a non-mirror id (primary card or other derived kind)", () => {
		expect(primaryTaskIdOfSpeculativeMirror("card-7")).toBe("card-7");
		expect(primaryTaskIdOfSpeculativeMirror("card-7::review")).toBe("card-7::review");
	});
});
