import { describe, expect, it } from "vitest";
import { downgradeSchemaForProfile } from "../../../src/core/provider-schema-downgrade";
import type { ProviderSchemaProfile } from "../../../src/core/provider-schema-profile";

const profile = (over: Partial<ProviderSchemaProfile> = {}): ProviderSchemaProfile => ({
	provider: "lmstudio",
	supportsNestedObjects: true,
	supportsEnum: true,
	supportsAdditionalProperties: true,
	maxDepth: 5,
	needsJsonRepairFallback: false,
	...over,
});

describe("downgradeSchemaForProfile", () => {
	it("is a no-op (structurally equal) when the profile supports everything within depth", () => {
		const schema = {
			type: "object",
			properties: { name: { type: "string" }, count: { type: "number" } },
			additionalProperties: false,
		};
		expect(downgradeSchemaForProfile(schema, profile())).toEqual(schema);
	});

	it("never mutates the input", () => {
		const schema = { type: "object", properties: { x: { type: "string", enum: ["a", "b"] } } };
		const copy = structuredClone(schema);
		downgradeSchemaForProfile(schema, profile({ supportsEnum: false }));
		expect(schema).toEqual(copy);
	});

	it("strips enum → keeps the type when enums are unsupported", () => {
		const out = downgradeSchemaForProfile(
			{ type: "object", properties: { color: { type: "string", enum: ["r", "g"] } } },
			profile({ supportsEnum: false }),
		);
		expect(out.properties).toEqual({ color: { type: "string" } });
	});

	it("gives a stripped enum a fallback type when it had none (inferred from members)", () => {
		const out = downgradeSchemaForProfile(
			{ type: "object", properties: { n: { enum: [1, 2, 3] }, s: { enum: ["a"] } } },
			profile({ supportsEnum: false }),
		);
		expect((out.properties as Record<string, unknown>).n).toEqual({ type: "number" });
		expect((out.properties as Record<string, unknown>).s).toEqual({ type: "string" });
	});

	it("forces additionalProperties:false when unsupported", () => {
		const out = downgradeSchemaForProfile(
			{ type: "object", properties: {}, additionalProperties: { type: "string" } },
			profile({ supportsAdditionalProperties: false }),
		);
		expect(out.additionalProperties).toBe(false);
	});

	it("collapses ANY nested object when nested objects are unsupported", () => {
		const out = downgradeSchemaForProfile(
			{ type: "object", properties: { inner: { type: "object", properties: { deep: { type: "string" } } } } },
			profile({ supportsNestedObjects: false }),
		);
		expect((out.properties as Record<string, unknown>).inner).toEqual({ type: "object" });
	});

	it("collapses objects nested beyond maxDepth (but keeps shallower ones)", () => {
		const schema = {
			type: "object", // depth 1
			properties: {
				a: {
					type: "object", // depth 2
					properties: {
						b: { type: "object", properties: { tooDeep: { type: "string" } } }, // depth 3 — collapses at maxDepth 2
					},
				},
			},
		};
		const out = downgradeSchemaForProfile(schema, profile({ maxDepth: 2 }));
		const a = (out.properties as Record<string, Record<string, unknown>>).a;
		expect(a.type).toBe("object");
		// its nested b (depth 3 > maxDepth 2) collapsed to a generic object
		expect((a.properties as Record<string, unknown>).b).toEqual({ type: "object" });
	});

	it("recurses into array items", () => {
		const out = downgradeSchemaForProfile(
			{ type: "array", items: { type: "string", enum: ["a", "b"] } },
			profile({ supportsEnum: false }),
		);
		expect(out.items).toEqual({ type: "string" });
	});

	it("normalizes a non-object schema position to an empty object node", () => {
		expect(downgradeSchemaForProfile(null, profile())).toEqual({});
		expect(downgradeSchemaForProfile("nope", profile())).toEqual({});
	});
});
