/**
 * §5.AA — decide what to do with a PARSED-but-imperfect tool-call ARGUMENTS object against the tool's schema:
 * repair it locally, re-ask ONLY the fields that are genuinely missing, or reject it — so a weak model's
 * almost-right call is salvaged deterministically instead of blindly re-forced or dropped (pure).
 *
 * WHAT: once a tool call is recovered — via `parseConstrainedToolCall`
 * ([nklein-constrained-tool-call.ts](../nklein-agent/nklein-constrained-tool-call.ts)) or narrated recovery
 * (`parseNarratedToolCalls`) — its `arguments` object is handed straight to the tool with NO schema check:
 * `coerceArguments` explicitly punts ("the tool validates its own inputs"). But a weak model routinely emits an
 * arguments object that is CLOSE: a required field stringified (`"count":"3"` for a `number`), a boolean as
 * `"true"`, a nested object left as a JSON STRING, a field name in the wrong case, a hallucinated EXTRA field,
 * or a required field simply absent. Feeding that raw to the tool trips an opaque runtime error (→ the tool
 * "just fails", or the whole turn is discarded and re-forced from scratch), when the fix is often a trivial
 * LOCAL coercion, or — if a required field is truly missing — a targeted re-ask of JUST that field rather than a
 * full constrained re-force. `assessToolArgumentRepair(call, tool)` is that missing decision:
 *   `{ verdict, repairedArguments?, fieldsToReask, issues, outcome, reason }`.
 *
 * WHY: this closes a real §5.AA gap that the parse/force cores leave open (grep-confirmed):
 *   - `parseConstrainedToolCall` / `coerceArguments` PARSE a call but never validate the args against the tool's
 *     declared `parameters` schema (they deliberately defer to the tool);
 *   - `narration-dialect.ts` decides WHICH dialect a stuck turn is in and whether a call is recoverable AT ALL —
 *     but stops at "a call was parsed", not "are its arguments usable";
 *   - `retry-policy.ts` has a `malformed` → `["constrained_schema", "prompt_variant", "best_of_n"]` ladder, but
 *     it treats a malformed call as an all-or-nothing re-force — nothing computes WHICH fields are wrong, whether
 *     a local repair suffices (no model round-trip at all), or which minimal fields to re-ask.
 * So today a coercible `"3"`→`3` arg and a genuinely-missing required field are handled identically: re-force the
 * whole call. This module distinguishes them on OBSERVABLE evidence (the schema + the args, never the model's
 * claim, per AGENTS.md), letting the loop apply the cheapest sufficient remedy: use-as-is, apply the local repair,
 * re-ask the missing fields only, or reject.
 *
 * EVIDENCE, NOT OPTIMISM (the robustness property): a value counts as "repaired" only when it is LOSSLESSLY and
 * unambiguously coercible to the declared type (a numeric-looking string to a `number`, `"true"`/`"false"` to a
 * `boolean`, a JSON-object/array string to `object`/`array`, whitespace-trim). An ambiguous or lossy value
 * (`"abc"` for a `number`, `"yes"` for a `boolean`) is NEVER guessed — it becomes a `reprompt` field (a wrong
 * required field) or is left AS-IS (a wrong optional field is surfaced as an issue but never fabricated). A field
 * the schema doesn't declare is dropped from the repaired object (recorded as an `unknown_field` issue) rather
 * than passed through. The verdict ladder is: **usable** (valid as-is) ⊂ **repairable** (a repaired object exists
 * AND no required field is still missing) ⊂ **reprompt** (a required field is absent or un-coercible — re-ask
 * exactly `fieldsToReask`) ⊂ **reject** (the args aren't an object at all, or the call names no known tool → the
 * whole call is unusable). `repairedArguments` is present whenever ANY lossless fix was possible (so the caller
 * can apply local repairs even when it must still reprompt for a separate missing field).
 *
 * Pure + deterministic + defensive: never throws, never mutates its inputs, and understands only a conservative
 * JSON-Schema subset (`type`, `properties`, `required`, `enum`) — an unrecognized/absent schema constraint is
 * treated permissively (the field is accepted, not invented). Composes `ModelOutcomeKind` (routes a `reprompt`/
 * `reject` to the `malformed` ladder) and `ParsedConstrainedToolCall` by import ONLY (no edits to siblings).
 */

import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ModelOutcomeKind } from "./model-behavior-profile";

/**
 * The action a caller should take for one imperfect tool call. Ordered by escalating cost:
 * `usable` (no action) → `repairable` (apply the local repair, no model round-trip) → `reprompt` (re-ask ONLY
 * the missing/un-coercible required fields) → `reject` (the call is unusable — fall through to the ladder).
 */
export enum ToolArgumentVerdict {
	/** The arguments already satisfy the schema — dispatch as-is. */
	Usable = "usable",
	/** Every problem is losslessly fixable locally — apply `repairedArguments` and dispatch, no re-ask. */
	Repairable = "repairable",
	/** A required field is absent or un-coercible — re-ask exactly `fieldsToReask` (apply any partial repair first). */
	Reprompt = "reprompt",
	/** The args aren't an object, or the call names no known tool — the whole call is unusable. */
	Reject = "reject",
}

/** The kind of problem found with one field (for the §5.AG "what happened" surface + inspectable reasons). */
export enum ToolArgumentIssueKind {
	/** A required field declared by the schema is absent from the arguments. */
	MissingRequired = "missing_required",
	/** A required field is present but its value's type is wrong AND not losslessly coercible — must be re-asked. */
	WrongRequiredType = "wrong_required_type",
	/** An optional field's value type is wrong AND not coercible — surfaced, but left as-is (never fabricated). */
	WrongOptionalType = "wrong_optional_type",
	/** A field's value was losslessly coerced to the declared type (`"3"`→`3`, `"true"`→`true`, JSON-string→object). */
	Coerced = "coerced",
	/** A field the schema does not declare — dropped from the repaired object. */
	UnknownField = "unknown_field",
	/** A field's value is not one of the schema's `enum` options (required ⇒ re-ask; optional ⇒ surfaced). */
	NotInEnum = "not_in_enum",
}

/** One problem found with one field, with an inspectable note. */
export interface ToolArgumentIssue {
	kind: ToolArgumentIssueKind;
	/** The field name (a top-level property of the arguments object). */
	field: string;
	/** Human-readable detail (e.g. `expected number, got string "3" — coerced`). */
	detail: string;
}

/** The full repair assessment for one parsed tool call. */
export interface ToolArgumentRepairResult {
	verdict: ToolArgumentVerdict;
	/**
	 * The locally-repaired arguments object, present whenever ANY lossless fix was applied (coercions applied,
	 * unknown fields dropped). Absent when nothing could be fixed (`usable` needs no repair; a `reject` has no
	 * usable object). On a `reprompt` this carries the partial repair — apply it, then re-ask `fieldsToReask`.
	 */
	repairedArguments?: Record<string, unknown>;
	/** The required fields that must be re-asked (absent or un-coercible) — empty unless the verdict is `reprompt`. */
	fieldsToReask: readonly string[];
	/** Every problem found, in field order (missing → wrong-type → enum → coerced → unknown). */
	issues: readonly ToolArgumentIssue[];
	/**
	 * The §5.AA outcome bucket this routes to. `success` for `usable`/`repairable` (a valid call is available —
	 * do NOT burn a retry); `malformed` for `reprompt`/`reject` (feed into `retryLadderForOutcome`). Kept in sync
	 * with `ModelOutcomeKind` so the decision composes with the existing ladder.
	 */
	outcome: ModelOutcomeKind;
	/** Inspectable one-line reason (for the §5.AG surface + the §5.AF ledger). */
	reason: string;
}

/** A parsed tool call to assess — the shape both `parseConstrainedToolCall` and narrated recovery produce. */
export interface ParsedToolCallToAssess {
	/** The tool name the model called. */
	name: string;
	/** The parsed arguments — `unknown` because a weak model may emit a non-object (string / null / array). */
	arguments: unknown;
}

/** A conservative JSON-Schema subset for one property. Unknown keywords are ignored (treated permissively). */
interface PropertySchema {
	type?: JsonSchemaType | readonly JsonSchemaType[];
	enum?: readonly unknown[];
}

type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract `{ properties, required }` from a tool's `parameters`, tolerant of a missing/oddly-shaped schema. */
function readSchema(parameters: Record<string, unknown> | undefined): {
	properties: Record<string, PropertySchema>;
	required: readonly string[];
	/** Whether the schema declared any `properties` at all — if not, we can't call an extra field "unknown". */
	hasDeclaredProperties: boolean;
} {
	const rawProps = parameters && isRecord(parameters.properties) ? parameters.properties : undefined;
	const properties: Record<string, PropertySchema> = {};
	if (rawProps) {
		for (const [key, value] of Object.entries(rawProps)) {
			properties[key] = isRecord(value) ? (value as PropertySchema) : {};
		}
	}
	const required =
		parameters && Array.isArray(parameters.required)
			? parameters.required.filter((entry): entry is string => typeof entry === "string")
			: [];
	return { properties, required, hasDeclaredProperties: rawProps !== undefined };
}

/** The runtime `typeof`-ish tag of a JSON value, mapped to schema type names (`integer` collapses to `number`). */
function jsonTypeOf(value: unknown): JsonSchemaType {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	const t = typeof value;
	if (t === "number") {
		return "number";
	}
	if (t === "boolean") {
		return "boolean";
	}
	if (t === "object") {
		return "object";
	}
	return "string";
}

/** Whether an actual value's type satisfies a declared type (or list of types); `integer` accepts a whole `number`. */
function typeMatches(declared: JsonSchemaType, actual: unknown): boolean {
	if (declared === "integer") {
		return typeof actual === "number" && Number.isInteger(actual);
	}
	if (declared === "number") {
		return typeof actual === "number";
	}
	return jsonTypeOf(actual) === declared;
}

function satisfiesType(schema: PropertySchema, value: unknown): boolean {
	if (schema.type === undefined) {
		return true; // no declared type ⇒ permissive
	}
	const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
	return declared.some((t) => typeMatches(t, value));
}

/**
 * Attempt a LOSSLESS coercion of `value` to one of the declared types. Returns the coerced value on success, or
 * `undefined` when no unambiguous, information-preserving coercion exists (never a lossy guess).
 */
function tryCoerce(declared: readonly JsonSchemaType[], value: unknown): { coerced: unknown } | undefined {
	// Trim a string whose only defect is surrounding whitespace and re-test below.
	const trimmedString = typeof value === "string" ? value.trim() : value;

	for (const type of declared) {
		if ((type === "number" || type === "integer") && typeof trimmedString === "string") {
			// Only a PLAIN decimal literal coerces. `Number()` also parses hex/octal/binary/scientific ("0x10"→16,
			// "0b101"→5, "1e3"→1000) — coercing those would FABRICATE a value from a string the model likely did not
			// intend as a number, violating the lossless/never-a-guess contract. The regex also rejects "" (Number("")=0).
			if (/^-?\d+(\.\d+)?$/.test(trimmedString)) {
				const n = Number(trimmedString);
				if (type === "integer" && !Number.isInteger(n)) {
					continue;
				}
				return { coerced: n };
			}
		}
		if (type === "boolean" && typeof trimmedString === "string") {
			const lower = trimmedString.toLowerCase();
			if (lower === "true") {
				return { coerced: true };
			}
			if (lower === "false") {
				return { coerced: false };
			}
		}
		if ((type === "object" || type === "array") && typeof trimmedString === "string" && trimmedString.length > 0) {
			// A JSON-encoded object/array left as a string (a common weak-model tic) ⇒ the parsed value.
			try {
				const parsed = JSON.parse(trimmedString);
				if (type === "object" && isRecord(parsed)) {
					return { coerced: parsed };
				}
				if (type === "array" && Array.isArray(parsed)) {
					return { coerced: parsed };
				}
			} catch {
				// not JSON — fall through
			}
		}
		// NB: a value that already matches a type never reaches here (satisfiesType short-circuits first), so an
		// already-valid string is left verbatim — we coerce only on a genuine type mismatch, never rewrite a valid value.
	}
	return undefined;
}

/**
 * Assess a parsed tool call's arguments against the tool's schema and decide: use as-is, repair locally, re-ask the
 * missing/un-coercible required fields, or reject. Pure + deterministic; never throws, never mutates its inputs.
 *
 * @param call  The parsed `{ name, arguments }` (arguments may be a non-object from a weak model).
 * @param tool  The offered tool definition whose `name` matches `call.name` and whose `parameters` is the schema.
 */
export function assessToolArgumentRepair(
	call: ParsedToolCallToAssess,
	tool: LocalLlmToolDefinition | undefined,
): ToolArgumentRepairResult {
	// A call naming no known/offered tool is unusable — the ladder must re-force, not repair a phantom.
	if (!tool || tool.name !== call.name) {
		return {
			verdict: ToolArgumentVerdict.Reject,
			fieldsToReask: [],
			issues: [],
			outcome: "malformed",
			reason: `no offered tool matches the called name "${call.name}"`,
		};
	}

	// Non-object arguments (a bare string / null / array) can't be field-repaired — reject the whole call.
	if (!isRecord(call.arguments)) {
		return {
			verdict: ToolArgumentVerdict.Reject,
			fieldsToReask: [],
			issues: [],
			outcome: "malformed",
			reason: `arguments for "${call.name}" are not an object (got ${jsonTypeOf(call.arguments)})`,
		};
	}

	const { properties, required, hasDeclaredProperties } = readSchema(tool.parameters);
	const requiredSet = new Set(required);
	const args = call.arguments;

	const issues: ToolArgumentIssue[] = [];
	const fieldsToReask: string[] = [];
	const repaired: Record<string, unknown> = {};
	let didRepair = false;

	// 1) Walk the PROVIDED fields: keep valid ones, coerce fixable ones, surface/route the rest, drop unknowns.
	for (const [field, value] of Object.entries(args)) {
		const schema = properties[field] as PropertySchema | undefined;

		if (schema === undefined) {
			if (hasDeclaredProperties && !requiredSet.has(field)) {
				// The schema declares its properties and this isn't one (and isn't required) ⇒ a hallucinated extra
				// field — drop it.
				issues.push({
					kind: ToolArgumentIssueKind.UnknownField,
					field,
					detail: `field "${field}" is not declared by the schema — dropped`,
				});
				didRepair = true;
				continue;
			}
			// No declared properties, OR a REQUIRED field with no `properties` entry (valid JSON Schema: `required` may
			// name a field absent from `properties`, meaning "must be present, any value") — pass it through untouched
			// rather than DROPPING a required value and then judging the call dispatchable without it.
			repaired[field] = value;
			continue;
		}

		// Compute a lossless coercion UP FRONT (when the raw value's type is wrong) so BOTH the enum gate and the
		// acceptance below operate on the value the tool would actually receive. Without this, a losslessly-coercible
		// enum value (the string "1" for a numeric enum [1,2,3]) is rejected as out-of-enum before coercion is ever
		// tried — refusing a repairable call, defeating this module's whole robustness purpose.
		const declared = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
		const coercion = !satisfiesType(schema, value) && declared.length > 0 ? tryCoerce(declared, value) : undefined;
		const effectiveValue = coercion ? coercion.coerced : value;
		// enum gate — tested against the EFFECTIVE (post-coercion) value: a genuinely out-of-enum value (e.g. "z" for
		// [1,2,3], which can't coerce) still routes to a re-ask, while "1"→1 falls through to be coerced below.
		if (schema.enum && schema.enum.length > 0 && !schema.enum.some((option) => option === effectiveValue)) {
			if (requiredSet.has(field)) {
				issues.push({
					kind: ToolArgumentIssueKind.NotInEnum,
					field,
					detail: `required field "${field}" value is not one of the allowed options`,
				});
				fieldsToReask.push(field);
			} else {
				issues.push({
					kind: ToolArgumentIssueKind.NotInEnum,
					field,
					detail: `optional field "${field}" value is not one of the allowed options — left as-is`,
				});
				repaired[field] = value;
			}
			continue;
		}

		if (satisfiesType(schema, value)) {
			repaired[field] = value;
			continue;
		}

		// Type mismatch but in-enum (or no enum) — apply the lossless coercion computed above.
		if (coercion) {
			repaired[field] = coercion.coerced;
			didRepair = true;
			issues.push({
				kind: ToolArgumentIssueKind.Coerced,
				field,
				detail: `expected ${declared.join("|")}, got ${jsonTypeOf(value)} — coerced`,
			});
			continue;
		}

		// Un-coercible: a required field must be re-asked; an optional one is surfaced but left as-is.
		if (requiredSet.has(field)) {
			issues.push({
				kind: ToolArgumentIssueKind.WrongRequiredType,
				field,
				detail: `required field "${field}" expected ${declared.join("|")}, got ${jsonTypeOf(value)} (un-coercible)`,
			});
			fieldsToReask.push(field);
		} else {
			issues.push({
				kind: ToolArgumentIssueKind.WrongOptionalType,
				field,
				detail: `optional field "${field}" expected ${declared.join("|")}, got ${jsonTypeOf(value)} — left as-is`,
			});
			repaired[field] = value;
		}
	}

	// 2) Missing required fields: any required field absent from the args must be re-asked (never fabricated).
	for (const field of required) {
		if (!(field in args)) {
			issues.push({
				kind: ToolArgumentIssueKind.MissingRequired,
				field,
				detail: `required field "${field}" is missing`,
			});
			if (!fieldsToReask.includes(field)) {
				fieldsToReask.push(field);
			}
		}
	}

	// 3) Verdict.
	if (fieldsToReask.length > 0) {
		// Some required field can't be filled locally — re-ask exactly those (applying any partial repair first).
		return {
			verdict: ToolArgumentVerdict.Reprompt,
			repairedArguments: didRepair ? repaired : undefined,
			fieldsToReask,
			issues,
			outcome: "malformed",
			reason: `re-ask ${fieldsToReask.length} required field(s): ${fieldsToReask.join(", ")}`,
		};
	}

	if (didRepair) {
		return {
			verdict: ToolArgumentVerdict.Repairable,
			repairedArguments: repaired,
			fieldsToReask: [],
			issues,
			outcome: "success",
			reason: `locally repaired ${issues.length} field issue(s) — no re-ask needed`,
		};
	}

	// Nothing needed fixing (any surfaced optional-type issues are non-blocking) — dispatch as-is.
	return {
		verdict: ToolArgumentVerdict.Usable,
		fieldsToReask: [],
		issues,
		outcome: "success",
		reason:
			issues.length > 0
				? `arguments satisfy required schema (${issues.length} non-blocking optional issue(s))`
				: "arguments satisfy the schema",
	};
}

/** Convenience: whether the call can be dispatched WITHOUT a model round-trip (as-is or after a local repair). */
export function isDispatchableAfterRepair(result: ToolArgumentRepairResult): boolean {
	return result.verdict === ToolArgumentVerdict.Usable || result.verdict === ToolArgumentVerdict.Repairable;
}

/**
 * Convenience: the arguments to actually dispatch — the repaired object when one was produced, else the original
 * (for `usable`). Returns `undefined` when the call is unusable (`reject`) or still needs a re-ask (`reprompt`
 * with no partial repair), signalling "don't dispatch this yet".
 */
export function dispatchArgumentsAfterRepair(
	call: ParsedToolCallToAssess,
	result: ToolArgumentRepairResult,
): Record<string, unknown> | undefined {
	if (result.verdict === ToolArgumentVerdict.Usable) {
		return isRecord(call.arguments) ? call.arguments : undefined;
	}
	if (result.verdict === ToolArgumentVerdict.Repairable) {
		return result.repairedArguments;
	}
	return undefined;
}
