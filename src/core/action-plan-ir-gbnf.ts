/**
 * GBNF grammar generator for the action-plan IR (todo §5.O — "grammar-constrained decoding for the IR").
 *
 * §5.O defines a typed intermediate representation (`action-plan-ir.ts`: an ordered list of `{id, tool, args, dependsOn}`
 * steps) that a small local model emits in one shot. `validateActionPlan` rejects a malformed plan AFTER generation — but
 * the strongest guarantee a local runtime can give is CONSTRAINED DECODING: feed llama.cpp / LM Studio a GBNF grammar and
 * the sampler can only ever emit tokens the grammar allows, so a structurally-valid plan is the ONLY thing the model can
 * produce. The client already carries the wire field for this (`nklein-local-llm-client` `LocalLlmStructuredFormat.grammar`,
 * forwarded as the llama.cpp server's top-level `grammar`). The missing piece — built here — is the grammar itself,
 * GENERATED from the IR shape so the two never drift.
 *
 * This module is PURE (a string builder, no I/O): it emits a GBNF that constrains output to the action-plan JSON shape,
 * and — when the caller passes the set of tools that actually exist — narrows the `tool` field to a closed alternation of
 * exactly those names. Constraining `tool` to known names is the highest-value lever for a weak model: hallucinated tool
 * names (the single most common §5.O failure) become literally un-emittable rather than caught after the fact.
 *
 * What is NOT here (the honest residual, why the todo box stays live-gated): whether a given llama.cpp / LM Studio build
 * accepts this exact GBNF and whether the model emits only valid IR *under* it can only be confirmed against a live
 * grammar decode — not unit-tested blind. `collectGbnfRuleReferences` gives the structural half of that assurance (no rule
 * is referenced without a definition), which we CAN test; the live half is owed to a grammar-capable model-roster session.
 */

/**
 * A tool name is embedded into the grammar as a JSON string terminal (`"read_file"`). GBNF string terminals are
 * double-quoted with backslash escapes, and the value itself is a JSON string, so a name flows through two escaping
 * layers. Reject a name that could break out of either — the generator must never emit a grammar an endpoint would
 * reject (or, worse, silently mis-parse). Real tool names are simple identifiers, so this only ever rejects garbage.
 */
const SAFE_TOOL_NAME = /^[A-Za-z0-9_.:-]+$/;

/** Options for {@link actionPlanIrToGbnf}. */
export interface ActionPlanIrGbnfOptions {
	/**
	 * The exact set of tool names the plan is allowed to call. When provided (non-empty), the grammar's `tool` field is a
	 * closed alternation of these names — the model cannot emit any other tool. When omitted/empty, `tool` accepts any
	 * JSON string (the plan is still shape-constrained; tool-name validity is checked later by the executor).
	 */
	toolNames?: readonly string[];
}

/**
 * The provider-independent JSON sub-grammar shared by every action-plan grammar. Adapted from llama.cpp's canonical
 * `json.gbnf`. Each rule is kept on a SINGLE line so {@link collectGbnfRuleReferences} can reason about it cheaply.
 */
const JSON_SUBGRAMMAR = [
	'object ::= "{" ws ( member ( ws "," ws member )* )? ws "}"',
	'member ::= string ws ":" ws value',
	'array ::= "[" ws ( value ( ws "," ws value )* )? ws "]"',
	"value ::= object | array | string | number | boolean | null",
	'boolean ::= "true" | "false"',
	'null ::= "null"',
	'string ::= "\\"" char* "\\""',
	'char ::= [^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" hex hex hex hex)',
	"hex ::= [0-9a-fA-F]",
	'number ::= "-"? int frac? exp?',
	'int ::= "0" | [1-9] [0-9]*',
	'frac ::= "." [0-9]+',
	"exp ::= [eE] [-+]? [0-9]+",
	"ws ::= [ \\t\\n]*",
] as const;

/** Escape a tool name for use inside a GBNF string terminal that itself denotes a JSON string: `name` → `"\"name\""`. */
function toolNameTerminal(name: string): string {
	// SAFE_TOOL_NAME has already excluded quotes/backslashes, so no further escaping of the name body is needed; the
	// wrapping produces a GBNF terminal whose literal value is the 2+len JSON string `"name"`.
	return `"\\"${name}\\""`;
}

/**
 * Build a GBNF grammar constraining a model's output to the action-plan IR shape (`{ "steps": [ { "id", "tool", "args",
 * "dependsOn"? } ... ] }`). Pure. When `options.toolNames` is a non-empty list of safe identifiers, the `tool` field is a
 * closed alternation of exactly those names; otherwise `tool` is any JSON string.
 *
 * `dependsOn` is optional in the grammar (it defaults to `[]` in the IR schema), so the model may omit it — matching what
 * `actionPlanStepSchema` accepts. `args` is any JSON object (each tool defines its own arg shape; the executor validates).
 *
 * @throws if any provided tool name is not a safe identifier (would corrupt the grammar).
 */
export function actionPlanIrToGbnf(options: ActionPlanIrGbnfOptions = {}): string {
	const names = options.toolNames ?? [];
	for (const name of names) {
		if (!SAFE_TOOL_NAME.test(name)) {
			throw new Error(
				`actionPlanIrToGbnf: unsafe tool name ${JSON.stringify(name)} — tool names must match ${SAFE_TOOL_NAME}.`,
			);
		}
	}
	// De-duplicate while preserving order so the alternation is minimal and deterministic.
	const uniqueNames = [...new Set(names)];
	const toolRule =
		uniqueNames.length > 0 ? `tool ::= ${uniqueNames.map(toolNameTerminal).join(" | ")}` : "tool ::= string";

	const rules = [
		// root → the whole plan object.
		'root ::= "{" ws "\\"steps\\"" ws ":" ws step-array ws "}"',
		'step-array ::= "[" ws ( step ( ws "," ws step )* )? ws "]"',
		// A step: id, tool, args are required and ordered; dependsOn is optional (schema default []).
		'step ::= "{" ws "\\"id\\"" ws ":" ws string ws "," ws "\\"tool\\"" ws ":" ws tool ws "," ws "\\"args\\"" ws ":" ws object ( ws "," ws "\\"dependsOn\\"" ws ":" ws string-array )? ws "}"',
		'string-array ::= "[" ws ( string ( ws "," ws string )* )? ws "]"',
		toolRule,
		...JSON_SUBGRAMMAR,
	];
	return `${rules.join("\n")}\n`;
}

/**
 * Extract the defined and referenced rule names from a GBNF grammar, so a caller (or test) can assert that no rule is
 * referenced without a definition — the one structural correctness property of a grammar we can check without a live
 * decode. Pure and conservative: it strips comments, string terminals, and character classes FIRST (so identifiers that
 * only appear inside a literal — e.g. `steps` inside `"\"steps\""`, or `t` inside `[ \t\n]` — are never mistaken for rule
 * references), then reads each rule's left-hand name and the rule-shaped identifiers on its right-hand side.
 *
 * A "rule name" is `[a-z][a-z0-9-]*` (lower-kebab), matching this module's naming and excluding GBNF operators.
 */
export function collectGbnfRuleReferences(grammar: string): {
	defined: Set<string>;
	referenced: Set<string>;
	danglingReferences: string[];
} {
	const defined = new Set<string>();
	const referenced = new Set<string>();
	const RULE_NAME = /[a-z][a-z0-9-]*/g;

	for (const rawLine of grammar.split("\n")) {
		// Drop a trailing comment.
		const line = rawLine.replace(/#.*$/, "");
		const sepIndex = line.indexOf("::=");
		if (sepIndex < 0) {
			continue;
		}
		const lhs = line.slice(0, sepIndex).trim();
		if (RULE_NAME.test(lhs)) {
			// A rule LHS is a single bare name.
			const nameMatch = lhs.match(/^[a-z][a-z0-9-]*/);
			if (nameMatch) {
				defined.add(nameMatch[0]);
			}
		}
		// Strip string terminals and character classes from the RHS so their contents are not read as references.
		const rhsStripped = line
			.slice(sepIndex + 3)
			// Double-quoted terminals, honouring `\"` and `\\` escapes.
			.replace(/"(?:\\.|[^"\\])*"/g, " ")
			// Character classes `[...]`, honouring `\]` escapes.
			.replace(/\[(?:\\.|[^\]\\])*\]/g, " ");
		RULE_NAME.lastIndex = 0;
		for (const match of rhsStripped.matchAll(RULE_NAME)) {
			referenced.add(match[0]);
		}
	}

	const danglingReferences = [...referenced].filter((name) => !defined.has(name)).sort();
	return { defined, referenced, danglingReferences };
}
