import { describe, expect, it, vi } from "vitest";
import { createPropertyBindingModelCaller } from "../../../src/nklein-agent/nklein-property-binding-model-caller";

const input = {
	invariants: [
		{ kind: "bounds" as const, statement: "result stays bounded", sourceLine: "result must be at most 10" },
	],
	scaffold: "placeholder",
	patch: "+export const clamp = () => 10",
};

describe("createPropertyBindingModelCaller", () => {
	it("prefers the required native tool-call contract", async () => {
		const completeWithTools = vi.fn(async (_request: unknown, _tools: unknown, _options?: unknown) => ({
			content: "",
			finishReason: "tool_calls",
			toolCalls: [
				{
					id: "1",
					name: "submit_property_binding",
					arguments: { status: "bound", testCode: "test code", rationale: "bound to clamp" },
				},
			],
			raw: {},
		}));
		const generateStructured = vi.fn();
		const result = await createPropertyBindingModelCaller({ completeWithTools, generateStructured })(input);
		expect(result).toEqual({ status: "bound", testCode: "test code", rationale: "bound to clamp" });
		expect(completeWithTools.mock.calls[0]?.[2]).toEqual({ toolChoice: "required" });
		expect(generateStructured).not.toHaveBeenCalled();
	});

	it("accepts an honest unavailable verdict through constrained fallback", async () => {
		const generateStructured = vi.fn(async (request: { parse(value: unknown): unknown }) =>
			request.parse({ status: "unavailable", testCode: "invented", rationale: "subject is not exposed" }),
		);
		const result = await createPropertyBindingModelCaller({ generateStructured } as never)(input);
		expect(result).toEqual({ status: "unavailable", testCode: "", rationale: "subject is not exposed" });
	});
});
