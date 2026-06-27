import { describe, expect, it } from "vitest";
import {
	relaxJsonSchemaNode,
	toPermissiveAgentInputSchema,
} from "../../../src/nklein-agent/decomposition/plan-task-schemas";

// `relaxJsonSchemaNode` deep-relaxes a JSON Schema for the SDK tool boundary (§5.O): strip every `required` and open
// `additionalProperties` so the SDK never pre-rejects a weak model's slightly-off call before the in-handler repair runs.
describe("relaxJsonSchemaNode", () => {
	it("strips `required` and opens `additionalProperties` on an object node", () => {
		expect(relaxJsonSchemaNode({ type: "object", required: ["a"], properties: { a: { type: "string" } } })).toEqual({
			type: "object",
			properties: { a: { type: "string" } },
			additionalProperties: true,
		});
	});

	it("replaces a closed `additionalProperties: false` with `true`", () => {
		expect(relaxJsonSchemaNode({ type: "object", additionalProperties: false })).toEqual({
			type: "object",
			additionalProperties: true,
		});
	});

	it("recurses into nested object properties, stripping `required` at every depth", () => {
		const input = {
			type: "object",
			required: ["outer"],
			properties: {
				outer: { type: "object", required: ["inner"], properties: { inner: { type: "string" } } },
			},
		};
		expect(relaxJsonSchemaNode(input)).toEqual({
			type: "object",
			additionalProperties: true,
			properties: {
				outer: { type: "object", additionalProperties: true, properties: { inner: { type: "string" } } },
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
			type: "object",
			additionalProperties: { type: "object", additionalProperties: true, properties: { x: { type: "number" } } },
		});
	});

	it("recurses through array `items` schemas", () => {
		expect(
			relaxJsonSchemaNode({
				type: "array",
				items: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
			}),
		).toEqual({
			type: "array",
			items: { type: "object", additionalProperties: true, properties: { a: { type: "string" } } },
		});
	});

	it("does not add `additionalProperties` to non-object-typed nodes", () => {
		expect(relaxJsonSchemaNode({ type: "string", description: "d" })).toEqual({ type: "string", description: "d" });
	});

	it("passes primitives, null, and arrays through", () => {
		expect(relaxJsonSchemaNode("x")).toBe("x");
		expect(relaxJsonSchemaNode(5)).toBe(5);
		expect(relaxJsonSchemaNode(null)).toBe(null);
		expect(relaxJsonSchemaNode([1, "a"])).toEqual([1, "a"]);
	});

	it("preserves descriptions and other schema metadata", () => {
		expect(
			relaxJsonSchemaNode({
				type: "object",
				description: "the task",
				required: ["a"],
				properties: { a: { type: "string", description: "field a" } },
			}),
		).toEqual({
			type: "object",
			description: "the task",
			additionalProperties: true,
			properties: { a: { type: "string", description: "field a" } },
		});
	});
});

describe("toPermissiveAgentInputSchema", () => {
	it("deep-relaxes the schema (delegates to relaxJsonSchemaNode)", () => {
		const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } } };
		expect(toPermissiveAgentInputSchema(schema)).toEqual(relaxJsonSchemaNode(schema));
		expect(toPermissiveAgentInputSchema(schema)).toEqual({
			type: "object",
			properties: { a: { type: "string" } },
			additionalProperties: true,
		});
	});
});
