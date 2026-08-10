import type { AgentTool } from "./sdk-agent-types";

/**
 * The permissive SDK tool boundary — one implementation for EVERY locally-defined agent tool.
 *
 * The SDK validates a tool call against its advertised inputSchema BEFORE the handler runs and answers any
 * violation with a multi-KB raw Zod dump that small local models cannot recover from (they spiral into empty
 * `{}` retries) and that burns the context budget. That defeats the handlers, which are written to answer
 * malformed input with SHORT, directive errors (or to parse-and-recover outright).
 *
 * This started as a decompose_project-only fix and turned out to be endemic: across one live P23.5 drain
 * campaign the same pre-rejection killed decompose_project (run 20260810-103422), add_task (20260810-195244,
 * ten truncated `{}` emissions), resolve_result (20260810-194712, maxChars 75000 for a bound execute() clamps),
 * and write_file (20260810-203016, TWENTY-FIVE truncated `{}` emissions — the worker's dominant failure). So the
 * relaxation now applies to every local tool at the session-assembly seam rather than tool-by-tool.
 *
 * MCP tools are exempt: their schemas belong to external servers, which validate server-side and may rely on
 * typed advertisement for their own contract.
 */

// Every JSON Schema keyword the SDK's up-front validator can FAIL a value against. Descriptions and structure
// (`properties`, `items`, `anyOf`) are kept as model-facing documentation; actual validation happens in the
// handlers.
const JSON_SCHEMA_VALIDATION_KEYWORDS = new Set([
	"type",
	"enum",
	"const",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"minLength",
	"maxLength",
	"pattern",
	"format",
	"minItems",
	"maxItems",
	"uniqueItems",
	"minProperties",
	"maxProperties",
]);

export function relaxJsonSchemaNode(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(relaxJsonSchemaNode);
	}
	if (node === null || typeof node !== "object") {
		return node;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		if (key === "required" || JSON_SCHEMA_VALIDATION_KEYWORDS.has(key)) {
			continue;
		}
		if (key === "additionalProperties") {
			// Drop the closed-object boolean form; relax a schema-valued additionalProperties (e.g. an
			// expansions map's value schema) in place rather than dropping it.
			if (typeof value !== "boolean") {
				result[key] = relaxJsonSchemaNode(value);
			}
			continue;
		}
		result[key] = relaxJsonSchemaNode(value);
	}
	return result;
}

export function toPermissiveAgentInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const relaxed = relaxJsonSchemaNode(schema) as Record<string, unknown>;
	// The root keeps its `type: "object"` — providers require a well-formed object schema at the tool boundary;
	// it is the NESTED validation keywords that turned typos into multi-KB pre-rejections.
	if (schema.type === "object") {
		return { ...relaxed, type: "object", additionalProperties: true };
	}
	return relaxed;
}

/**
 * Relax every listed tool's advertised schema at the session-assembly seam. Tools named in `skipToolNames`
 * (MCP-registered) keep their schemas verbatim. Idempotent: relaxing an already-relaxed schema is a no-op.
 */
export function relaxAgentToolSchemas(
	tools: readonly AgentTool[],
	options: { skipToolNames?: ReadonlySet<string> } = {},
): AgentTool[] {
	return tools.map((tool) => {
		if (options.skipToolNames?.has(tool.name)) {
			return tool;
		}
		if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
			return tool;
		}
		return { ...tool, inputSchema: toPermissiveAgentInputSchema(tool.inputSchema as Record<string, unknown>) };
	});
}
