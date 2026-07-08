import { describe, expect, it } from "vitest";
import { planStructuredOutputRequest } from "../../../src/core/structured-output-request-plan";

// A strict-valid schema (every object sets additionalProperties:false + lists all keys in required).
const strictSchema = {
	type: "object",
	additionalProperties: false,
	properties: { city: { type: "string" } },
	required: ["city"],
};

describe("planStructuredOutputRequest", () => {
	it("null strategy → none", () => {
		expect(planStructuredOutputRequest({ strategy: null, schema: strictSchema, schemaName: "x" })).toEqual({
			kind: "none",
		});
	});

	it("prose_extract → prose_extract", () => {
		expect(
			planStructuredOutputRequest({ strategy: "prose_extract", schema: strictSchema, schemaName: "x" }).kind,
		).toBe("prose_extract");
	});

	it("json_schema_grammar with a strict-valid schema → response_format", () => {
		const plan = planStructuredOutputRequest({
			strategy: "json_schema_grammar",
			schema: strictSchema,
			schemaName: "weather",
		});
		expect(plan.kind).toBe("response_format");
		if (plan.kind === "response_format") {
			expect(plan.responseFormat.type).toBe("json_schema");
			expect(plan.responseFormat.json_schema.name).toBe("weather");
			expect(plan.responseFormat.json_schema.strict).toBe(true);
		}
	});

	it("native_tool_call → native_tool_call intent carrying the schema + name", () => {
		const plan = planStructuredOutputRequest({
			strategy: "native_tool_call",
			schema: strictSchema,
			schemaName: "weather",
		});
		expect(plan.kind).toBe("native_tool_call");
		if (plan.kind === "native_tool_call") {
			expect(plan.schemaName).toBe("weather");
			expect(plan.targetSchema).toBe(strictSchema);
			expect(plan.reason).toMatch(/reasoning-safe|universal/);
		}
	});

	it("json_schema_grammar with an UNBUILDABLE schema falls back to native_tool_call (no broken envelope)", () => {
		// A non-object schema can't build a response_format → must degrade to the native intent, not emit garbage.
		const plan = planStructuredOutputRequest({
			strategy: "json_schema_grammar",
			schema: "not-a-schema-object",
			schemaName: "weather",
		});
		expect(plan.kind).toBe("native_tool_call");
		if (plan.kind === "native_tool_call") {
			expect(plan.reason).toMatch(/json_schema unbuildable/);
			expect(plan.targetSchema).toBe("not-a-schema-object");
		}
	});

	it("json_schema_grammar with an illegal schema NAME also falls back to native (name is server-rejected)", () => {
		const plan = planStructuredOutputRequest({
			strategy: "json_schema_grammar",
			schema: strictSchema,
			schemaName: "bad name!with spaces",
		});
		expect(plan.kind).toBe("native_tool_call");
		if (plan.kind === "native_tool_call") {
			expect(plan.reason).toMatch(/json_schema unbuildable/);
		}
	});
});
