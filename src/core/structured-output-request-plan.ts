/**
 * §5.AN structured-output ENVELOPE plan (pure) — turn a chosen {@link StructuredOutputStrategy} + a target JSON Schema
 * into the concrete request-shape the model-call seam applies.
 *
 * The layering here is deliberate. Three modules cooperate, each a pure step:
 *   1. `structured-output-strategy.ts` decides WHICH mechanism a given model can honor (json_schema vs native tool vs
 *      prose) — the reasoning-safe choice.
 *   2. `skill-api-profile-request.ts` carries that chosen strategy on the resolved profile request.
 *   3. THIS module turns `(strategy, schema)` into the concrete envelope the seam sends.
 *
 * For `json_schema_grammar` we can build the full `response_format` right here ({@link buildJsonSchemaResponseFormat} is
 * a core module). For `native_tool_call` we return an INTENT (`schemaName` + `targetSchema`) rather than the built tool,
 * because the constrained-tool builder lives in `nklein-agent/` and core must not depend upward — the seam (in
 * nklein-agent) builds the tool from this intent. This keeps the boundary clean while still making the decision +
 * response_format construction fully unit-testable without a live model.
 *
 * ROBUSTNESS: if `json_schema_grammar` is chosen but the schema can't be built into a valid strict `response_format`
 * (buildJsonSchemaResponseFormat returns errors — e.g. a strict-mode structural violation that would fail SILENTLY at
 * request time), we FALL BACK to the `native_tool_call` intent rather than emitting a broken envelope. Better a working
 * tool-call than a silent empty-content dead-end.
 */

import {
	buildJsonSchemaResponseFormat,
	type JsonSchemaResponseFormat,
	type ResponseFormatError,
} from "./lmstudio-response-format.js";
import type { StructuredOutputStrategy } from "./structured-output-strategy.js";

/**
 * The concrete envelope the seam should apply, as a discriminated union:
 * - `response_format` — send `responseFormat` on the request (json_schema, guaranteed-valid content).
 * - `native_tool_call` — build a single constrained tool from `targetSchema`/`schemaName` and send it with
 *   `tool_choice:"required"` (the reasoning-safe path; the tool build itself happens at the nklein-agent seam).
 * - `prose_extract` — send no constraint; parse the JSON out of the reply (via the shared `repairJsonValue`).
 * - `none` — structured output not requested / not applicable.
 */
export type StructuredOutputRequestPlan =
	| { kind: "response_format"; responseFormat: JsonSchemaResponseFormat }
	| { kind: "native_tool_call"; schemaName: string; targetSchema: unknown; reason: string }
	| { kind: "prose_extract" }
	| { kind: "none" };

export interface PlanStructuredOutputRequestInput {
	/** The chosen strategy, or null when structured output isn't preferred (⇒ `{kind:"none"}`). */
	strategy: StructuredOutputStrategy | null;
	/** The target JSON Schema the output must conform to. */
	schema: unknown;
	/** A schema/tool name (`[A-Za-z0-9_-]{1,64}`); used for the response_format name and the native tool name. */
	schemaName: string;
}

/**
 * Turn a chosen strategy + schema into the concrete {@link StructuredOutputRequestPlan} (pure). See the module doc for
 * the fallback rule: a `json_schema_grammar` whose schema fails to build a valid strict `response_format` degrades to the
 * `native_tool_call` intent rather than emitting a broken/ silently-failing envelope.
 */
export function planStructuredOutputRequest(input: PlanStructuredOutputRequestInput): StructuredOutputRequestPlan {
	const { strategy, schema, schemaName } = input;
	if (strategy === null) {
		return { kind: "none" };
	}

	if (strategy === "prose_extract") {
		return { kind: "prose_extract" };
	}

	if (strategy === "json_schema_grammar") {
		const built = buildJsonSchemaResponseFormat({ name: schemaName, schema });
		if (built.ok) {
			return { kind: "response_format", responseFormat: built.responseFormat };
		}
		return {
			kind: "native_tool_call",
			schemaName,
			targetSchema: schema,
			reason: `json_schema unbuildable (${summarizeErrors(built.errors)}) — fell back to native tool_call`,
		};
	}

	// native_tool_call (the reasoning-safe path, or the universal default).
	return {
		kind: "native_tool_call",
		schemaName,
		targetSchema: schema,
		reason: "strategy selected native tool_call (reasoning-safe / universal default)",
	};
}

function summarizeErrors(errors: ResponseFormatError[]): string {
	return errors.map((e) => e.code).join(", ") || "unknown";
}
