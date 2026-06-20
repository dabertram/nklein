import { describe, expect, it } from "vitest";
import {
	classifyTaskPatchCaptureFailure,
	isTaskPatchCaptureError,
	TaskPatchCaptureError,
} from "../../../src/workspace/task-patch-capture-diagnostics";

const SAMPLE_PATCH = [
	"diff --git a/src/sequence.ts b/src/sequence.ts",
	"index 1111111..2222222 100644",
	"--- a/src/sequence.ts",
	"+++ b/src/sequence.ts",
	"@@ -1,3 +1,4 @@",
	" export const beats = 4;",
	"+export const swing = 0;",
	" export const tempo = 145;",
	"diff --git a/README.md b/README.md",
	"--- a/README.md",
	"+++ b/README.md",
	"@@ -10,2 +10,3 @@",
	" usage",
	"+more usage",
].join("\n");

describe("classifyTaskPatchCaptureFailure", () => {
	it("classifies a corrupt patch and locates the failing file/hunk by line", () => {
		const details = classifyTaskPatchCaptureFailure("error: corrupt patch at line 5", SAMPLE_PATCH);
		expect(details.classification).toBe("corrupt_patch");
		expect(details.failingLine).toBe(5);
		expect(details.firstFailingFile).toBe("src/sequence.ts");
		expect(details.firstFailingHunkHeader).toBe("@@ -1,3 +1,4 @@");
	});

	it("classifies a non-applying patch and extracts the file from the git error", () => {
		const details = classifyTaskPatchCaptureFailure(
			"error: patch failed: README.md:10\nerror: README.md: patch does not apply",
			SAMPLE_PATCH,
		);
		expect(details.classification).toBe("apply_failed");
		expect(details.firstFailingFile).toBe("README.md");
		expect(details.failingLine).toBe(10);
	});

	it("falls back to the first patch file when the git error names none", () => {
		const details = classifyTaskPatchCaptureFailure("error: something unexpected", SAMPLE_PATCH);
		expect(details.classification).toBe("apply_failed");
		expect(details.firstFailingFile).toBe("src/sequence.ts");
	});
});

describe("TaskPatchCaptureError", () => {
	it("builds a descriptive message and is detectable via the type guard", () => {
		const error = new TaskPatchCaptureError({
			taskId: "psytrance-vst-synth-task-2",
			preservedPatchPath: "/tmp/p.patch",
			classification: "corrupt_patch",
			gitError: "corrupt patch at line 53",
			failingLine: 53,
			firstFailingFile: "src/plugin.ts",
			firstFailingHunkHeader: "@@ -1,2 +1,3 @@",
		});
		expect(isTaskPatchCaptureError(error)).toBe(true);
		expect(error.message).toContain("corrupt_patch");
		expect(error.message).toContain("src/plugin.ts");
		expect(error.preservedPatchPath).toBe("/tmp/p.patch");
	});
});
