/**
 * §5.AN: build + validate LM Studio's `response_format` structured-output payload from an INJECTED target JSON Schema (pure).
 *
 * Structured output is the headline "get more out of every model" lever on the OpenAI-compat `/v1/chat/completions`
 * surface: `response_format: { type: "json_schema", json_schema: { name, schema, strict } }` engages LM Studio's
 * constraint-based generation engine, which is the ONLY live-verified mechanism that FORCES schema-valid JSON even on a
 * model that would otherwise narrate (§5.AN — OpenAI `tool_choice:"required"` and the Anthropic `tool_choice` do NOT force
 * on LM Studio; constrained decoding does). Today the wire payload is assembled ad-hoc at the model-call seam
 * (`nklein-local-llm-client.ts` inlines `{ type:"json_schema", json_schema:{…} }`) and the only schema BUILDER in the repo
 * is tool-call-specific (`nklein-constrained-tool-call.ts`). This module is the GENERIC, provider-agnostic core: give it any
 * target schema and it returns the exact envelope — after catching, deterministically and OFFLINE, the structured-output
 * footguns that otherwise fail SILENTLY at request time (an illegal schema `name`, a non-object schema, or a strict-mode
 * schema that omits `additionalProperties:false` / under-fills `required`).
 *
 * It also exposes {@link wrapSchemaForStrict}: take a lax schema and get back a strict-compliant COPY (recursively adds
 * `additionalProperties:false` and lists every declared property in `required`) — so a caller can turn any schema into one
 * that actually enforces, which is the whole point of the lever.
 *
 * Pure + total: no I/O, no network, no model call, no clock. Inputs are plain values; nothing here contacts LM Studio.
 * Validators collect ALL problems (never throw, never partially build) and report machine-stable codes + a path to each
 * offending node, so the caller can surface exactly what to fix.
 */

/** The `/v1` structured-output payload, byte-for-byte what the OpenAI-compat endpoint expects on `response_format`. */
export interface JsonSchemaResponseFormat {
	type: "json_schema";
	json_schema: {
		name: string;
		schema: Record<string, unknown>;
		strict: boolean;
	};
}

/** A single validation problem: a machine-stable {@link code}, a human message, and a path to the offending schema node. */
export interface ResponseFormatError {
	code: "invalid_name" | "schema_not_object" | "strict_missing_additional_properties" | "strict_required_incomplete";
	message: string;
	/** JSON-pointer-ish path to the node the error is about (`"#"` = the root schema). */
	path: string;
}

/** Result of {@link buildJsonSchemaResponseFormat}: the ready payload, or the collected reasons it could not be built. */
export type BuildResponseFormatResult =
	| { ok: true; responseFormat: JsonSchemaResponseFormat }
	| { ok: false; errors: ResponseFormatError[] };

export interface BuildResponseFormatOptions {
	/**
	 * Emit `strict: true` AND enforce the strict-mode structural rules (every object with `properties` sets
	 * `additionalProperties:false` and lists every declared key in `required`). Default `true` — strict is the mode that
	 * makes the constraint engine actually pin the shape; a schema that violates the rules under strict mode fails
	 * SILENTLY at request time, so we reject it here instead. Set `false` to build a lax `strict:false` payload with no
	 * structural enforcement (the model is guided, not forced).
	 */
	strict?: boolean;
}

/** OpenAI / LM Studio constrain the schema `name` to this alphabet + length; an illegal name is rejected server-side. */
const SCHEMA_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build a validated `response_format` payload from a target JSON Schema (pure). First match on the name + schema-shape
 * preconditions is collected alongside any strict-mode structural violations, so ONE call reports every fixable problem.
 *
 * Returns `{ ok:true, responseFormat }` with the exact `{ type:"json_schema", json_schema:{ name, schema, strict } }`
 * envelope when the inputs are usable, otherwise `{ ok:false, errors }`. The `schema` is passed through by reference
 * unchanged (this builder does not rewrite it — use {@link wrapSchemaForStrict} first if you need it made strict-safe).
 *
 * @param input.name The `json_schema.name` (must match {@link SCHEMA_NAME_PATTERN}).
 * @param input.schema The target JSON Schema — must be a plain object (a JSON-Schema mapping), not an array/primitive/null.
 * @param input.options.strict See {@link BuildResponseFormatOptions.strict} (defaults to `true`).
 */
export function buildJsonSchemaResponseFormat(input: {
	name: string;
	schema: unknown;
	options?: BuildResponseFormatOptions;
}): BuildResponseFormatResult {
	const strict = input.options?.strict ?? true;
	const errors: ResponseFormatError[] = [];

	if (typeof input.name !== "string" || !SCHEMA_NAME_PATTERN.test(input.name)) {
		errors.push({
			code: "invalid_name",
			message: "schema name must be 1-64 chars of [A-Za-z0-9_-]",
			path: "#",
		});
	}

	if (!isPlainObject(input.schema)) {
		errors.push({
			code: "schema_not_object",
			message: "schema must be a plain JSON-Schema object (not an array, primitive, or null)",
			path: "#",
		});
		// Without an object schema there is nothing to structurally validate; return what we have.
		return { ok: false, errors };
	}

	if (strict) {
		collectStrictViolations(input.schema, "#", errors);
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		responseFormat: {
			type: "json_schema",
			json_schema: { name: input.name, schema: input.schema, strict },
		},
	};
}

/**
 * Walk a schema and record every strict-mode structural violation. OpenAI's strict structured-output mode (mirrored by LM
 * Studio's constraint engine) requires that for EACH object node declaring `properties`: (a) `additionalProperties` is
 * `false`, and (b) `required` lists EVERY declared property key. A node that breaks either rule is silently rejected at
 * request time, so we surface it. Recurses through `properties`, the array `items`, and the `anyOf`/`allOf`/`oneOf`
 * combinators so nested objects are checked too. Non-schema shapes are skipped (they are the caller's concern).
 */
function collectStrictViolations(node: unknown, path: string, errors: ResponseFormatError[]): void {
	if (!isPlainObject(node)) {
		return;
	}

	const properties = node.properties;
	if (isPlainObject(properties)) {
		const declared = Object.keys(properties);

		if (node.additionalProperties !== false) {
			errors.push({
				code: "strict_missing_additional_properties",
				message: "strict mode requires additionalProperties:false on every object with properties",
				path,
			});
		}

		const required = Array.isArray(node.required)
			? new Set(node.required.filter((k): k is string => typeof k === "string"))
			: new Set<string>();
		const missing = declared.filter((key) => !required.has(key));
		if (missing.length > 0) {
			errors.push({
				code: "strict_required_incomplete",
				message: `strict mode requires every property in \`required\`; missing: ${missing.join(", ")}`,
				path,
			});
		}

		for (const key of declared) {
			collectStrictViolations(properties[key], `${path}/properties/${key}`, errors);
		}
	}

	if (isPlainObject(node.items)) {
		collectStrictViolations(node.items, `${path}/items`, errors);
	}

	for (const combinator of ["anyOf", "allOf", "oneOf"] as const) {
		const branches = node[combinator];
		if (Array.isArray(branches)) {
			branches.forEach((branch, index) => {
				collectStrictViolations(branch, `${path}/${combinator}/${index}`, errors);
			});
		}
	}
}

/**
 * Return a strict-mode-compliant DEEP COPY of `schema` (pure; the input is never mutated). For every object node that
 * declares `properties`, this sets `additionalProperties:false` and rewrites `required` to list EXACTLY the declared
 * property keys (preserving their declaration order); it recurses into `properties`, array `items`, and the
 * `anyOf`/`allOf`/`oneOf` combinators. The output is guaranteed to pass {@link buildJsonSchemaResponseFormat} under
 * `strict:true`, so callers can accept a lax author-friendly schema and still get enforced structured output.
 *
 * Non-object inputs are returned unchanged (there is nothing to make strict). Existing `required` entries not present in
 * `properties` are dropped (they cannot be satisfied under `additionalProperties:false`).
 */
export function wrapSchemaForStrict(schema: unknown): unknown {
	if (Array.isArray(schema)) {
		return schema.map((item) => wrapSchemaForStrict(item));
	}
	if (!isPlainObject(schema)) {
		return schema;
	}

	const out: Record<string, unknown> = { ...schema };

	const properties = schema.properties;
	if (isPlainObject(properties)) {
		const declared = Object.keys(properties);
		const rewrittenProps: Record<string, unknown> = {};
		for (const key of declared) {
			rewrittenProps[key] = wrapSchemaForStrict(properties[key]);
		}
		out.properties = rewrittenProps;
		out.additionalProperties = false;
		out.required = declared;
	}

	if (out.items !== undefined) {
		out.items = wrapSchemaForStrict(schema.items);
	}

	for (const combinator of ["anyOf", "allOf", "oneOf"] as const) {
		const branches = schema[combinator];
		if (Array.isArray(branches)) {
			out[combinator] = branches.map((branch) => wrapSchemaForStrict(branch));
		}
	}

	return out;
}
