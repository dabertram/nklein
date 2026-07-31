/**
 * P20.3b — generate the NO-OP STUB an ablation replaces an artifact with. PURE core.
 *
 * ── WHAT THE ABLATION IS ──
 * Stub out the artifact the agent claims to have built and re-run the tests. **If they still pass, the artifact is
 * decorative.** "Building to the Test" (arXiv 2606.28430) showed production agents scoring 222/222 on a hidden
 * oracle while the library they were asked to build sat inert — the demo had reimplemented the tested behaviour
 * inline. The verdict half is shipped (`no-op-ablation.ts`, consumable via `dev ablation`); this is the stub.
 *
 * ── THE RULE THIS MODULE EXISTS TO ENFORCE ──
 * **Every stubbed entry point THROWS. It never returns a plausible default.** A stub returning `null`, `0`, `[]`
 * or `""` lets tests pass for the WRONG reason — they would report `decorative` for an artifact that is genuinely
 * load-bearing but tolerant of empty input. That is a FALSE ACCUSATION, and it is the expensive direction: it
 * sends someone to delete working code.
 *
 * ── WHY AN UNRECOGNISED EXPORT ABORTS INSTEAD OF BEING SKIPPED ──
 * The same asymmetry, one level up. An export this module fails to stub stays REAL, so tests exercising it keep
 * passing — and the ablation reports `decorative` for an artifact it never actually removed. **A partial stub is
 * not a weaker measurement, it is a wrong one**, and it fails in the direction that accuses working code. So
 * anything not positively recognised is a refusal, and the refusal names the line.
 *
 * ── WHY TYPE EXPORTS ARE PRESERVED RATHER THAN STUBBED ──
 * Types are erased at runtime and cannot make a test pass, so stubbing them buys nothing — but DROPPING them
 * breaks compilation, and a build failure in the ablated run reads as every test failing. `assessNoOpAblation`
 * would call that `inconclusive` rather than `decorative`, so it is not a false accusation; it is simply a run
 * that measured nothing. They are re-exported from the original module instead.
 *
 * ── SCOPE: THIS PRODUCES SOURCE, IT DOES NOT SUBSTITUTE IT ──
 * How the stub replaces the real module in a running suite (source swap, loader hook, or test-framework mock) is
 * deliberately NOT decided here — it differs per project and per runner, and picking one silently would bake a
 * guess into the measurement. Recorded as the remaining open half of P20.3b.
 */

/** One export the stub replaces or preserves. */
export interface StubbedExport {
	readonly name: string;
	readonly kind: "function" | "class" | "value" | "type";
}

export type StubGenerationResult =
	| { readonly ok: true; readonly source: string; readonly exports: readonly StubbedExport[] }
	| {
			readonly ok: false;
			/** `unrecognised_export` — a form this module will not silently leave real. `no_exports` — nothing to ablate. */
			readonly reason: "unrecognised_export" | "no_exports";
			readonly detail: string;
	  };

/** Marks a stub call in test output, so a failure traces to the ablation rather than reading as a real bug. */
export const NO_OP_STUB_MARKER = "NO-OP ABLATION STUB";

/** Export forms that CANNOT be enumerated from this file alone, and therefore cannot be safely stubbed. */
const OPAQUE_EXPORT_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{
		pattern: /^\s*export\s+\*/u,
		why: "`export *` re-exports names this module cannot enumerate, so some would stay real and the ablation would report `decorative` for code it never removed",
	},
	{
		pattern: /^\s*export\s+\{[^}]*\}\s*from\s/u,
		why: "a re-export from another module cannot be stubbed here — stub that module instead",
	},
	{
		pattern: /^\s*export\s+default\b/u,
		why: "a default export has no name to reference from the stub; give it a named export to make it ablatable",
	},
];

const VALUE_DECLARATION =
	/^\s*export\s+(?:declare\s+)?(?:(async\s+)?function\*?|(abstract\s+)?class|const|let|var)\s+([A-Za-z_$][\w$]*)/u;
const TYPE_DECLARATION = /^\s*export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/u;
/** `export { a, b as c }` — enumerable, unlike the `from`-bearing form above. */
const LOCAL_EXPORT_LIST = /^\s*export\s+\{([^}]*)\}\s*;?\s*$/u;

function classifyValue(line: string): StubbedExport["kind"] {
	if (/\bfunction\b/u.test(line)) {
		return "function";
	}
	return /\bclass\b/u.test(line) ? "class" : "value";
}

/**
 * Build a stub module for `source`, importing types back from `originalSpecifier`.
 *
 * Refuses rather than guessing. A caller that gets `ok: false` must NOT fall back to a partial stub — the whole
 * point is that a half-removed artifact produces a confident wrong answer.
 */
export function generateNoOpStub(input: {
	readonly source: string;
	/** Module specifier the stub re-exports TYPES from, e.g. `"./thing.original"`. */
	readonly originalSpecifier: string;
}): StubGenerationResult {
	const lines = input.source.split("\n");
	const valueExports: StubbedExport[] = [];
	const typeExports: StubbedExport[] = [];
	let inBlockComment = false;

	for (const [index, line] of lines.entries()) {
		// Comment tracking, because a doc-comment showing `export * from "…"` as an EXAMPLE would otherwise abort a
		// perfectly stubbable module — and this codebase's headers are full of such examples.
		if (inBlockComment) {
			if (line.includes("*/")) {
				inBlockComment = false;
			}
			continue;
		}
		if (/^\s*\/\*/u.test(line) && !line.includes("*/")) {
			inBlockComment = true;
			continue;
		}
		if (/^\s*(\/\/|\*)/u.test(line) || !line.includes("export")) {
			continue;
		}

		const opaque = OPAQUE_EXPORT_PATTERNS.find((entry) => entry.pattern.test(line));
		if (opaque) {
			return {
				ok: false,
				reason: "unrecognised_export",
				detail: `line ${index + 1}: ${line.trim()} — ${opaque.why}`,
			};
		}

		const typeMatch = TYPE_DECLARATION.exec(line);
		if (typeMatch) {
			typeExports.push({ name: typeMatch[1] as string, kind: "type" });
			continue;
		}
		const valueMatch = VALUE_DECLARATION.exec(line);
		if (valueMatch) {
			valueExports.push({ name: valueMatch[3] as string, kind: classifyValue(line) });
			continue;
		}
		const listMatch = LOCAL_EXPORT_LIST.exec(line);
		if (listMatch) {
			for (const entry of (listMatch[1] as string).split(",")) {
				const trimmed = entry.trim();
				if (trimmed.length === 0) {
					continue;
				}
				// `a as b` exports the name `b`; a stub keyed on `a` would leave `b` unexported and break the import.
				const exported =
					trimmed
						.split(/\s+as\s+/u)
						.pop()
						?.trim() ?? trimmed;
				const isType = /^type\s/u.test(trimmed);
				(isType ? typeExports : valueExports).push({
					name: exported,
					kind: isType ? "type" : "value",
				});
			}
			continue;
		}

		// `export` appeared on a line that matched nothing known. Refusing here is the whole discipline: a form
		// this module does not understand is a form it cannot promise to have removed.
		if (/^\s*export\b/u.test(line)) {
			return {
				ok: false,
				reason: "unrecognised_export",
				detail: `line ${index + 1}: ${line.trim()} — unrecognised export form; refusing to emit a stub that might leave it real`,
			};
		}
	}

	if (valueExports.length === 0) {
		return {
			ok: false,
			reason: "no_exports",
			detail:
				typeExports.length > 0
					? "the module exports only types, which are erased at runtime and cannot make a test pass — there is nothing here an ablation could measure"
					: "no exports found, so there is no artifact to ablate",
		};
	}

	const body: string[] = [
		`/** Generated ${NO_OP_STUB_MARKER}. Every entry point THROWS — never a plausible default. */`,
	];
	if (typeExports.length > 0) {
		// Types come from the original module: erased at runtime, so they cannot affect the measurement, but
		// dropping them would fail the build and turn the ablated run into a no-measurement instead of a verdict.
		body.push(
			`export type { ${typeExports.map((entry) => entry.name).join(", ")} } from "${input.originalSpecifier}";`,
		);
	}
	body.push(
		`function __ablated(name: string): never {`,
		`\tthrow new Error(\`${NO_OP_STUB_MARKER}: \${name} was called. This artifact was stubbed out; a test reaching this line depends on it.\`);`,
		`}`,
	);
	for (const entry of valueExports) {
		if (entry.kind === "class") {
			// A class must throw from its CONSTRUCTOR, not merely be undefined: `new Thing()` on an undefined
			// binding throws a TypeError that reads like a harness bug rather than a stub report.
			body.push(`export class ${entry.name} {`, `\tconstructor() {`, `\t\t__ablated("${entry.name}");`, `\t}`, `}`);
			continue;
		}
		if (entry.kind === "function") {
			body.push(
				`export function ${entry.name}(...__args: unknown[]): never {`,
				`\t__ablated("${entry.name}");`,
				`}`,
			);
			continue;
		}
		// A plain value could be read without being called, so a throwing GETTER is the only way to make mere
		// access fail — a `const` holding a throwing function would silently pass any test that just reads it.
		body.push(
			`export const ${entry.name}: never = new Proxy({} as never, {`,
			`\tget: () => __ablated("${entry.name}"),`,
			`\tapply: () => __ablated("${entry.name}"),`,
			`});`,
		);
	}

	return { ok: true, source: `${body.join("\n")}\n`, exports: [...valueExports, ...typeExports] };
}
