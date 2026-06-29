import { describe, expect, it } from "vitest";
import { classifyTaskComplexity } from "../../../src/core/task-complexity";

describe("classifyTaskComplexity", () => {
	it("novel: ambiguous spec, repeated failure, or a design/research framing", () => {
		expect(classifyTaskComplexity({ ambiguous: true })).toBe("novel");
		expect(classifyTaskComplexity({ priorFailedAttempts: 2 })).toBe("novel");
		expect(classifyTaskComplexity({ taskText: "design a new caching architecture from scratch" })).toBe("novel");
	});

	it("complex: multi-file, many tools, one prior failure, or a multi-step framing", () => {
		expect(classifyTaskComplexity({ multiFile: true })).toBe("complex");
		expect(classifyTaskComplexity({ estimatedToolCount: 3 })).toBe("complex");
		expect(classifyTaskComplexity({ priorFailedAttempts: 1 })).toBe("complex");
		expect(classifyTaskComplexity({ taskText: "refactor the session module end-to-end" })).toBe("complex");
	});

	it("trivial: a short, tool-free lookup/format ask", () => {
		expect(classifyTaskComplexity({ taskText: "rename the variable foo", estimatedToolCount: 0 })).toBe("trivial");
		expect(classifyTaskComplexity({ taskText: "what is the default port?" })).toBe("trivial");
	});

	it("standard: a normal task with no strong signal", () => {
		expect(classifyTaskComplexity({ taskText: "add a unit test for the parser" })).toBe("standard");
		expect(classifyTaskComplexity({})).toBe("standard");
	});

	it("precedence: novel outranks complex (ambiguous + multi-file → novel)", () => {
		expect(classifyTaskComplexity({ ambiguous: true, multiFile: true, estimatedToolCount: 5 })).toBe("novel");
	});

	it("a long lookup-worded task is NOT trivial (length gate guards against big asks)", () => {
		const long = `look up ${"x".repeat(120)}`;
		expect(classifyTaskComplexity({ taskText: long })).toBe("standard");
	});
});
