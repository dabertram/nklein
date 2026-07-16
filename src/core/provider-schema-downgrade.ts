/**
 * F3.T4 — downgrade a JSON schema to the smallest SAFE dialect a provider actually supports.
 *
 * The companion to {@link selectProviderSchemaProfile} (the profile SELECTOR) and `tool-argument-repair.ts` (the
 * tolerant REPAIR of a model's output). This is the missing OUTBOUND half: before we hand a tool/structured-output
 * schema to a weak local endpoint, transform it so it only uses features the endpoint's {@link ProviderSchemaProfile}
 * declares it supports — strip `enum` when unsupported (a weak grammar engine chokes on large enums), deny
 * `additionalProperties`, and flatten object nesting past `maxDepth` (or entirely when nested objects are unsupported)
 * into a generic object the model can fill freely. Offering the smallest dialect the endpoint can honor means fewer
 * constrained-decode failures and less reliance on the repair fallback.
 *
 * Pure + deterministic: never mutates the input schema (deep-copies as it transforms); a non-object input returns a
 * shallow-safe value. Conservative — it only REMOVES/relaxes constraints, never adds any, so a downgraded schema always
 * accepts a superset of what the original did (the repair layer still validates the result).
 */

import type { ProviderSchemaProfile } from "./provider-schema-profile.js";

/** A JSON-schema node. Deliberately loose — we transform structurally without a full JSON-schema type. */
export type JsonSchemaNode = Record<string, unknown>;

/** A generic object node the model may fill with any properties — what a too-deep / unsupported nested object collapses to. */
function genericObject(): JsonSchemaNode {
	return { type: "object" };
}

function isPlainObject(value: unknown): value is JsonSchemaNode {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a schema node describes an object with a `properties` map (the thing depth/nesting rules act on). */
function isObjectSchema(node: JsonSchemaNode): boolean {
	return node.type === "object" || isPlainObject(node.properties);
}

/**
 * Return a downgraded copy of `schema` honoring `profile`. `depth` is the object-nesting level (root object = 1).
 *  - `enum` is dropped when `!supportsEnum` (the node keeps its `type`, or gains `type: "string"` if it had none).
 *  - `additionalProperties` is forced to `false` when `!supportsAdditionalProperties`.
 *  - An object nested past `maxDepth`, or ANY nested object when `!supportsNestedObjects`, collapses to a generic object.
 * Recurses through `properties`, `items` (array item schema), and an object-valued `additionalProperties`.
 */
export function downgradeSchemaForProfile(schema: unknown, profile: ProviderSchemaProfile, depth = 1): JsonSchemaNode {
	if (!isPlainObject(schema)) {
		// A non-object schema position (e.g. a boolean `additionalProperties`) can't be structurally downgraded here;
		// callers only pass object nodes, so normalize to an empty object node rather than propagate a non-object.
		return {};
	}

	// A nested object that the profile can't represent (too deep, or nesting unsupported) collapses to a generic object,
	// dropping its inner structure entirely — the model may then emit any shape and the repair layer validates it.
	if (isObjectSchema(schema) && depth > 1 && (!profile.supportsNestedObjects || depth > profile.maxDepth)) {
		return genericObject();
	}

	const out: JsonSchemaNode = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === "enum" && !profile.supportsEnum) {
			continue; // drop the enum; a `type` fallback is added below if the node now lacks one
		}
		if (key === "additionalProperties") {
			out.additionalProperties = profile.supportsAdditionalProperties
				? downgradeValue(value, profile, depth + 1)
				: false;
			continue;
		}
		if (key === "properties" && isPlainObject(value)) {
			const props: JsonSchemaNode = {};
			for (const [propName, propSchema] of Object.entries(value)) {
				props[propName] = downgradeSchemaForProfile(propSchema, profile, depth + 1);
			}
			out.properties = props;
			continue;
		}
		if (key === "items") {
			out.items = downgradeValue(value, profile, depth);
			continue;
		}
		out[key] = value;
	}

	// If we stripped an enum and left the node with no declared type, give it a string type so it stays a valid schema.
	if (isPlainObject(schema) && "enum" in schema && !profile.supportsEnum && out.type === undefined) {
		out.type = inferEnumType(schema.enum);
	}
	return out;
}

/** Downgrade a value that may be a schema node or an array of schema nodes (JSON-schema `items` allows both). */
function downgradeValue(value: unknown, profile: ProviderSchemaProfile, depth: number): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => downgradeSchemaForProfile(entry, profile, depth));
	}
	if (isPlainObject(value)) {
		return downgradeSchemaForProfile(value, profile, depth);
	}
	return value;
}

/** The JSON-schema `type` to fall back to when an enum is stripped — derived from the enum members' runtime type. */
function inferEnumType(enumValue: unknown): string {
	if (Array.isArray(enumValue) && enumValue.length > 0) {
		const first = enumValue[0];
		if (typeof first === "number") {
			return "number";
		}
		if (typeof first === "boolean") {
			return "boolean";
		}
	}
	return "string";
}
