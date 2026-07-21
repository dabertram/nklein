import { describe, expect, it } from "vitest";
import {
	createSessionResultHandles,
	handleLargeToolResult,
	RESULT_HANDLE_RESOLVER_TOOL_NAME,
} from "../../../src/nklein-agent/nklein-result-handle-tool";

describe("live result-handle bridge (F4.7)", () => {
	it("keeps small results byte-for-byte and allocation-free", () => {
		const { store } = createSessionResultHandles();
		const original = { output: "short result" };
		expect(handleLargeToolResult({ toolName: "read_files", result: original, store, contextWindow: 32_000 })).toBe(
			original,
		);
	});

	it("stores a large bulk result and leaves a compact head+tail handle notice", () => {
		const { store } = createSessionResultHandles();
		const originalOutput = `HEAD:${"x".repeat(14_000)}:TAIL`;
		const handled = handleLargeToolResult({
			toolName: "read_files",
			result: { output: originalOutput },
			store,
			contextWindow: 32_000,
		});
		const handle = handled.metadata?.resultHandle;
		expect(typeof handle).toBe("string");
		expect(handled.output).toContain("Large read_files result stored as result://read_files/1");
		expect(handled.output).toContain("HEAD:");
		expect(handled.output).toContain(":TAIL");
		expect(store.get(String(handle))).toBe(originalOutput);
	});

	it("never hides failed or control-plane results", () => {
		const { store } = createSessionResultHandles();
		const output = "x".repeat(20_000);
		const failed = { output, isError: true };
		const control = { output };
		expect(handleLargeToolResult({ toolName: "run_command", result: failed, store })).toBe(failed);
		expect(handleLargeToolResult({ toolName: "decompose_project", result: control, store })).toBe(control);
	});

	it("resolves bounded slices and rejects invalid or unknown handles", () => {
		const { store, tool } = createSessionResultHandles();
		expect(tool.name).toBe(RESULT_HANDLE_RESOLVER_TOOL_NAME);
		const value = `zero-${"x".repeat(20_000)}-end`;
		const handle = store.put("search_code", value);
		const context = { agentId: "agent", iteration: 1 };
		const first = String(tool.execute({ handle }, context));
		expect(first).toContain("characters 0-8000 of 20009");
		expect(first).toContain("[next offset: 8000]");
		const tail = String(tool.execute({ handle, offset: 20_000, maxChars: 20_000 }, context));
		expect(tail).toContain("characters 20000-20009 of 20009");
		expect(tail).toContain("-end");
		expect(tail).toContain("[end of result]");
		expect(String(tool.execute({ handle, offset: 99_999 }, context))).toContain("characters 20009-20009");
		expect(() => tool.execute({ handle: "bad" }, context)).toThrow(/valid result/);
		expect(() => tool.execute({ handle: "result://search_code/999" }, context)).toThrow(/Unknown/);
	});
});
