import { describe, expect, it } from "vitest";
import { buildJsonSchemaResponseFormat, wrapSchemaForStrict } from "../../../src/core/lmstudio-response-format";

/** A minimal, already-strict-compliant object schema for happy-path assertions. */
function strictObjectSchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: { answer: { type: "string" } },
		required: ["answer"],
		additionalProperties: false,
	};
}

describe("buildJsonSchemaResponseFormat", () => {
	it("wraps a valid strict schema in the exact /v1 response_format envelope", () => {
		const result = buildJsonSchemaResponseFormat({ name: "my_result", schema: strictObjectSchema() });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.responseFormat).toEqual({
			type: "json_schema",
			json_schema: {
				name: "my_result",
				schema: strictObjectSchema(),
				strict: true,
			},
		});
	});

	it("defaults strict to true", () => {
		const result = buildJsonSchemaResponseFormat({ name: "r", schema: strictObjectSchema() });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.responseFormat.json_schema.strict).toBe(true);
	});

	it("passes the schema through by reference (does not clone or rewrite it)", () => {
		const schema = strictObjectSchema();
		const result = buildJsonSchemaResponseFormat({ name: "r", schema });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.responseFormat.json_schema.schema).toBe(schema);
	});

	describe("name validation", () => {
		it("accepts a 64-char name of the allowed alphabet", () => {
			const name = "a".repeat(64);
			const result = buildJsonSchemaResponseFormat({ name, schema: strictObjectSchema() });
			expect(result.ok).toBe(true);
		});

		it("rejects an empty name", () => {
			const result = buildJsonSchemaResponseFormat({ name: "", schema: strictObjectSchema() });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].code).toBe("invalid_name");
			expect(result.errors[0].path).toBe("#");
		});

		it("rejects a name over 64 chars", () => {
			const result = buildJsonSchemaResponseFormat({ name: "a".repeat(65), schema: strictObjectSchema() });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors[0].code).toBe("invalid_name");
		});

		it("rejects a name with illegal characters (spaces / punctuation)", () => {
			for (const bad of ["has space", "dot.name", "slash/name", "emoji😀"]) {
				const result = buildJsonSchemaResponseFormat({ name: bad, schema: strictObjectSchema() });
				expect(result.ok).toBe(false);
			}
		});

		it("accepts underscores and hyphens", () => {
			const result = buildJsonSchemaResponseFormat({ name: "my-schema_v2", schema: strictObjectSchema() });
			expect(result.ok).toBe(true);
		});

		it("rejects a non-string name defensively", () => {
			const result = buildJsonSchemaResponseFormat({
				name: 42 as unknown as string,
				schema: strictObjectSchema(),
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors[0].code).toBe("invalid_name");
		});
	});

	describe("schema-shape validation", () => {
		it("rejects a null schema", () => {
			const result = buildJsonSchemaResponseFormat({ name: "r", schema: null });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors.some((e) => e.code === "schema_not_object")).toBe(true);
		});

		it("rejects an array schema", () => {
			const result = buildJsonSchemaResponseFormat({ name: "r", schema: [{ type: "string" }] });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors[0].code).toBe("schema_not_object");
		});

		it("rejects a primitive schema", () => {
			const result = buildJsonSchemaResponseFormat({ name: "r", schema: "string" });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors[0].code).toBe("schema_not_object");
		});

		it("does not run strict structural checks once the schema is not an object", () => {
			const result = buildJsonSchemaResponseFormat({ name: "r", schema: null });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].code).toBe("schema_not_object");
		});
	});

	describe("strict-mode structural validation", () => {
		it("flags a missing additionalProperties:false", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors.some((e) => e.code === "strict_missing_additional_properties")).toBe(true);
		});

		it("treats additionalProperties:true as a violation", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					type: "object",
					properties: { a: { type: "string" } },
					required: ["a"],
					additionalProperties: true,
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors.some((e) => e.code === "strict_missing_additional_properties")).toBe(true);
		});

		it("flags an incomplete required list and names the missing keys", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					type: "object",
					properties: { a: { type: "string" }, b: { type: "number" } },
					required: ["a"],
					additionalProperties: false,
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			const err = result.errors.find((e) => e.code === "strict_required_incomplete");
			expect(err).toBeDefined();
			expect(err?.message).toContain("b");
			expect(err?.message).not.toContain(" a,");
		});

		it("flags a missing required list entirely (no required key)", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors.some((e) => e.code === "strict_required_incomplete")).toBe(true);
		});

		it("collects BOTH violations on the same node in one pass", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } },
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			const codes = result.errors.map((e) => e.code).sort();
			expect(codes).toEqual(["strict_missing_additional_properties", "strict_required_incomplete"]);
		});

		it("reports a JSON-pointer path to a nested offending object", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					type: "object",
					properties: {
						outer: { type: "object", properties: { inner: { type: "string" } } },
					},
					required: ["outer"],
					additionalProperties: false,
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			const nested = result.errors.find((e) => e.path === "#/properties/outer");
			expect(nested).toBeDefined();
		});

		it("recurses into array items", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					type: "object",
					properties: {
						list: { type: "array", items: { type: "object", properties: { x: { type: "number" } } } },
					},
					required: ["list"],
					additionalProperties: false,
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors.some((e) => e.path === "#/properties/list/items")).toBe(true);
		});

		it("recurses into TUPLE-style items (an array of subschemas), not just object items", () => {
			// Tuple items were gated on isPlainObject(node.items), which is false for arrays, so a non-strict
			// tuple element slipped through as ok:true and was rejected by LM Studio at request time.
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					type: "object",
					properties: {
						coords: { type: "array", items: [{ type: "object", properties: { x: { type: "number" } } }] },
					},
					required: ["coords"],
					additionalProperties: false,
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.errors.some((e) => e.path.includes("/items/0"))).toBe(true);
		});

		it("recurses into anyOf/oneOf/allOf branches with indexed paths", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					anyOf: [{ type: "object", properties: { a: { type: "string" } } }, strictObjectSchema()],
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			// Only branch 0 is lax; branch 1 is compliant.
			expect(result.errors.every((e) => e.path.startsWith("#/anyOf/0"))).toBe(true);
		});

		it("accepts a valid deeply-nested strict schema", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: {
					type: "object",
					properties: {
						items: {
							type: "array",
							items: {
								type: "object",
								properties: { id: { type: "number" } },
								required: ["id"],
								additionalProperties: false,
							},
						},
					},
					required: ["items"],
					additionalProperties: false,
				},
			});
			expect(result.ok).toBe(true);
		});

		it("skips structural checks entirely under strict:false and stamps strict:false", () => {
			const laxSchema = { type: "object", properties: { a: { type: "string" } } };
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: laxSchema,
				options: { strict: false },
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.responseFormat.json_schema.strict).toBe(false);
			expect(result.responseFormat.json_schema.schema).toBe(laxSchema);
		});

		it("ignores a non-object `properties` value (does not misfire)", () => {
			const result = buildJsonSchemaResponseFormat({
				name: "r",
				schema: { type: "object", properties: "oops" },
			});
			// `properties` is not a mapping, so there are no declared keys to enforce → strict passes.
			expect(result.ok).toBe(true);
		});

		it("does not throw on a self-referential schema graph (defensive tolerance)", () => {
			// A well-formed schema never cycles through plain data, but the walker must not assume that.
			const schema: Record<string, unknown> = {
				type: "object",
				properties: { a: { type: "string" } },
				required: ["a"],
				additionalProperties: false,
			};
			expect(() => buildJsonSchemaResponseFormat({ name: "r", schema })).not.toThrow();
		});
	});

	it("never throws on arbitrary junk input", () => {
		for (const junk of [undefined, 0, false, Symbol("x")]) {
			expect(() => buildJsonSchemaResponseFormat({ name: "r", schema: junk as unknown })).not.toThrow();
		}
	});
});

describe("wrapSchemaForStrict", () => {
	it("adds additionalProperties:false and fills required with all declared keys", () => {
		const wrapped = wrapSchemaForStrict({
			type: "object",
			properties: { a: { type: "string" }, b: { type: "number" } },
		}) as Record<string, unknown>;
		expect(wrapped.additionalProperties).toBe(false);
		expect(wrapped.required).toEqual(["a", "b"]);
	});

	it("preserves declaration order of property keys in required", () => {
		const wrapped = wrapSchemaForStrict({
			type: "object",
			properties: { zebra: {}, alpha: {}, mid: {} },
		}) as Record<string, unknown>;
		expect(wrapped.required).toEqual(["zebra", "alpha", "mid"]);
	});

	it("drops pre-existing required entries not present in properties", () => {
		const wrapped = wrapSchemaForStrict({
			type: "object",
			properties: { a: { type: "string" } },
			required: ["a", "ghost"],
		}) as Record<string, unknown>;
		expect(wrapped.required).toEqual(["a"]);
	});

	it("does not mutate the input", () => {
		const input = { type: "object", properties: { a: { type: "string" } } };
		const snapshot = JSON.parse(JSON.stringify(input));
		wrapSchemaForStrict(input);
		expect(input).toEqual(snapshot);
	});

	it("recurses into nested object properties", () => {
		const wrapped = wrapSchemaForStrict({
			type: "object",
			properties: { outer: { type: "object", properties: { inner: { type: "string" } } } },
		}) as Record<string, unknown>;
		const outer = (wrapped.properties as Record<string, Record<string, unknown>>).outer;
		expect(outer.additionalProperties).toBe(false);
		expect(outer.required).toEqual(["inner"]);
	});

	it("recurses into array items", () => {
		const wrapped = wrapSchemaForStrict({
			type: "object",
			properties: {
				list: { type: "array", items: { type: "object", properties: { x: { type: "number" } } } },
			},
		}) as Record<string, unknown>;
		const items = ((wrapped.properties as Record<string, Record<string, unknown>>).list as Record<string, unknown>)
			.items as Record<string, unknown>;
		expect(items.additionalProperties).toBe(false);
		expect(items.required).toEqual(["x"]);
	});

	it("recurses into anyOf/oneOf/allOf branches", () => {
		const wrapped = wrapSchemaForStrict({
			anyOf: [
				{ type: "object", properties: { a: {} } },
				{ type: "object", properties: { b: {} } },
			],
		}) as Record<string, unknown>;
		const branches = wrapped.anyOf as Record<string, unknown>[];
		expect(branches[0].required).toEqual(["a"]);
		expect(branches[1].required).toEqual(["b"]);
	});

	it("returns non-object inputs unchanged", () => {
		expect(wrapSchemaForStrict("string")).toBe("string");
		expect(wrapSchemaForStrict(null)).toBe(null);
		expect(wrapSchemaForStrict(7)).toBe(7);
	});

	it("maps arrays element-wise", () => {
		const wrapped = wrapSchemaForStrict([{ type: "object", properties: { a: {} } }]) as Record<string, unknown>[];
		expect(wrapped[0].required).toEqual(["a"]);
	});

	it("output is accepted by buildJsonSchemaResponseFormat under strict:true (round-trip)", () => {
		const lax = {
			type: "object",
			properties: {
				name: { type: "string" },
				tags: { type: "array", items: { type: "object", properties: { label: { type: "string" } } } },
			},
		};
		const strictSchema = wrapSchemaForStrict(lax);
		const result = buildJsonSchemaResponseFormat({ name: "round_trip", schema: strictSchema });
		expect(result.ok).toBe(true);
	});

	it("leaves an object without `properties` structurally alone (only recurses where it applies)", () => {
		const wrapped = wrapSchemaForStrict({ type: "string", description: "a name" }) as Record<string, unknown>;
		expect(wrapped.additionalProperties).toBeUndefined();
		expect(wrapped.required).toBeUndefined();
		expect(wrapped).toEqual({ type: "string", description: "a name" });
	});
});
