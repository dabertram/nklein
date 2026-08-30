import { describe, expect, it } from "vitest";
import {
	relaxJsonSchemaNode,
	toPermissiveAgentInputSchema,
} from "../../../src/nklein-agent/decomposition/plan-task-schemas";

// `relaxJsonSchemaNode` deep-relaxes a JSON Schema for the SDK tool boundary (§5.O): strip every `required`, every
// closed `additionalProperties`, and every validation keyword EXCEPT plain `type: "string"` — kept since 2026-08-30:
// llama.cpp builds its tool grammar FROM the advertised schema, and a typeless property admits any JSON value, which
// a hedging model fills with minimal tokens ({"id": null} / {"id": "0"} — eleven junk drain runs). String types are
// grammar guidance for exactly the fields a model must FILL; {}-vs-required and numeric/length clamps (the documented
// pre-rejection incidents, 20260810) keep their relaxation. Descriptions and structure survive as documentation.
describe("relaxJsonSchemaNode", () => {
	it("strips `required` and every validation keyword, keeping structure", () => {
		expect(relaxJsonSchemaNode({ type: "object", required: ["a"], properties: { a: { type: "string" } } })).toEqual({
			properties: { a: { type: "string" } },
		});
	});

	it("drops the closed `additionalProperties: false` form", () => {
		expect(relaxJsonSchemaNode({ type: "object", additionalProperties: false })).toEqual({});
	});

	it("recurses into nested object properties, stripping keywords at every depth", () => {
		const input = {
			type: "object",
			required: ["outer"],
			properties: {
				outer: { type: "object", required: ["inner"], properties: { inner: { type: "string", minLength: 1 } } },
			},
		};
		expect(relaxJsonSchemaNode(input)).toEqual({
			properties: {
				outer: { properties: { inner: { type: "string" } } },
			},
		});
	});

	it("relaxes a schema-valued `additionalProperties` in place rather than dropping it", () => {
		expect(
			relaxJsonSchemaNode({
				type: "object",
				additionalProperties: { type: "object", required: ["x"], properties: { x: { type: "number" } } },
			}),
		).toEqual({
			additionalProperties: { properties: { x: {} } }, // number type stays stripped (clamp-class keyword family)
		});
	});

	it("recurses through array `items` schemas", () => {
		expect(
			relaxJsonSchemaNode({
				type: "array",
				items: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
			}),
		).toEqual({
			items: { properties: { a: { type: "string" } } },
		});
	});

	it("passes primitives, null, and arrays through", () => {
		expect(relaxJsonSchemaNode("x")).toBe("x");
		expect(relaxJsonSchemaNode(5)).toBe(5);
		expect(relaxJsonSchemaNode(null)).toBe(null);
		expect(relaxJsonSchemaNode([1, "a"])).toEqual([1, "a"]);
	});

	it("preserves descriptions and other model-facing documentation", () => {
		expect(
			relaxJsonSchemaNode({
				type: "object",
				description: "the task",
				required: ["a"],
				properties: { a: { type: "string", description: "field a" } },
			}),
		).toEqual({
			description: "the task",
			properties: { a: { type: "string", description: "field a" } },
		});
	});
});

describe("toPermissiveAgentInputSchema", () => {
	it("deep-relaxes the schema but restores the root object type providers require", () => {
		const schema = {
			type: "object",
			required: ["a"],
			properties: { a: { type: "string", description: "field a" } },
		};
		expect(toPermissiveAgentInputSchema(schema)).toEqual({
			type: "object",
			additionalProperties: true,
			properties: { a: { type: "string", description: "field a" } },
		});
	});

	it("leaves nothing the SDK validator can fail a nested value against", () => {
		const relaxed = toPermissiveAgentInputSchema({
			type: "object",
			properties: {
				tasks: {
					type: "array",
					items: {
						type: "object",
						required: ["id"],
						properties: { id: { type: "string" }, dependsOn: { type: "array", items: { type: "string" } } },
					},
				},
			},
		});
		const nested = JSON.stringify((relaxed as { properties: unknown }).properties);
		// `type: "string"` survives BY DESIGN (grammar guidance); everything else stays stripped.
		expect(nested).not.toContain('"required"');
		expect(nested).not.toContain('"minLength"');
		expect(nested).not.toContain('"number"');
	});
});
