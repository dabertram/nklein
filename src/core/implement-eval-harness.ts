/**
 * P22.2 / decision 2026-07-31 — RUN the `implement` eval family instead of skipping it. PURE core.
 *
 * ── WHY THIS FAMILY WAS NEVER EXECUTED ──
 * `implement` is the only eval family that measures whether code actually WORKS, rather than whether a model can
 * describe, review or select. Scoring it means executing model-generated code, so `model-eval-runner` skipped the
 * whole family with a bare `continue` — leaving prompts in the corpus that implied coverage they never provided.
 *
 * ── THE SECURITY BOUNDARY, AND WHAT IT ACTUALLY COVERS ──
 * This module builds a SCRIPT; the caller runs it in a child process under Node's permission model
 * (`--permission`). Verified on this platform (Node 25) that the flag denies, with `ERR_ACCESS_DENIED`:
 * filesystem reads, `child_process`, `net` (outbound sockets), and `process.binding`. Combined with a wall-clock
 * timeout for non-termination, that is a real boundary rather than a hopeful one.
 *
 * **It is NOT a claim that arbitrary hostile code is contained.** The threat model here is a LOCAL MODEL
 * answering a fixed corpus prompt asking for a pure function — accident and incompetence, not a targeted escape.
 * A different threat model (untrusted third-party submissions) would need the Docker isolation !Klein already
 * uses for agent work.
 *
 * ── WHY THE HARNESS IS WRITTEN SO DEFENSIVELY ──
 * The model's code runs BEFORE the assertions and in the same realm, so it can redefine `console`, throw at
 * definition time, or call `process.exit`. The script therefore captures its output function up front, prints a
 * SENTINEL-delimited JSON payload, and treats a missing sentinel as "no scorable answer" rather than as zero —
 * a model that exits early has not scored 0/N, it has failed to report, and those are different facts.
 */

/** One assertion from an `implement` prompt: a JS expression that must evaluate truthy. */
export interface ImplementTest {
	readonly name: string;
	readonly assertion: string;
}

/** Marks the harness's own output, so model `console.log` noise cannot be mistaken for the result. */
export const IMPLEMENT_RESULT_SENTINEL = "<<<NKLEIN_IMPLEMENT_RESULT>>>";

export interface ImplementHarnessResult {
	readonly passed: number;
	readonly total: number;
	/** Per-test outcome, so a failure names WHICH assertion rather than only a count. */
	readonly failures: readonly { readonly name: string; readonly error: string }[];
}

/**
 * Build the script executed in the sandboxed child.
 *
 * The model's code is embedded verbatim — NOT wrapped in a function — because an implementation may legitimately
 * declare helpers, constants or classes at top level, and wrapping would change which of those the assertions can
 * see. Correctness of the embedding is guaranteed by the sentinel protocol instead of by escaping.
 */
export function buildImplementHarnessScript(input: { code: string; tests: readonly ImplementTest[] }): string {
	return [
		// Captured BEFORE the model's code runs: it may redefine `console`, and the result must survive that.
		"const __write = process.stdout.write.bind(process.stdout);",
		"const __failures = [];",
		"let __passed = 0;",
		// A definition-time throw is reported as every test failing for that reason, which is accurate: nothing was
		// defined, so nothing could pass. Handled via `uncaughtException` rather than a `try` block — see below.
		"process.on('uncaughtException', (error) => {",
		`  __write('\\n' + ${JSON.stringify(IMPLEMENT_RESULT_SENTINEL)} + JSON.stringify({`,
		`    passed: 0, total: ${String(input.tests.length)},`,
		"    failures: [{ name: '(definition)', error: String((error && error.message) || error) }],",
		"  }) + '\\n');",
		"  process.exit(0);",
		"});",
		// ⚠️ TRUE TOP LEVEL — deliberately NOT inside a `try` block.
		//
		// Wrapping the candidate looked harmless and was not: `class`, `let` and `const` are BLOCK-scoped, so a
		// candidate declaring `class LRUCache {...}` inside a wrapper left it invisible to the assertions and every
		// test failed with "LRUCache is not defined". `function` declarations survived only through hoisting, which
		// is why simpler candidates passed and hid the bug.
		//
		// Found by running the corpus's OWN reference implementations through the harness — 5/5 and 4/4 for the
		// function-based prompts, 0/5 for the class-based one. A unit test asserting the script TEXT contains the
		// candidate passed throughout; only executing it revealed the scoping.
		input.code,
		// Assertions run inside an async IIFE and are AWAITED. Some behaviours cannot be asserted synchronously —
		// a debounce only proves itself after its timer fires — and forcing every assertion to be synchronous
		// would either exclude those prompts or reduce them to testing the parts that happen to be immediate.
		"(async () => {",
		...input.tests.map((test) =>
			[
				"try {",
				`  const __ok = await (${test.assertion});`,
				"  if (__ok) { __passed += 1; }",
				`  else { __failures.push({ name: ${JSON.stringify(test.name)}, error: 'assertion was falsy' }); }`,
				"} catch (error) {",
				`  __failures.push({ name: ${JSON.stringify(test.name)}, error: String((error && error.message) || error) });`,
				"}",
			].join("\n"),
		),
		`__write('\\n' + ${JSON.stringify(IMPLEMENT_RESULT_SENTINEL)} + JSON.stringify({`,
		`  passed: __passed, total: ${String(input.tests.length)}, failures: __failures,`,
		"}) + '\\n');",
		// `process.exit` rather than falling off the end: a candidate may have left a pending timer or handle
		// (a debounce test necessarily does), and waiting for the event loop to drain would hit the timeout and
		// discard a result that was already computed.
		"  process.exit(0);",
		"})();",
	].join("\n");
}

/**
 * Read the harness's result out of the child's stdout.
 *
 * Returns null when the sentinel is absent — a crash, a timeout, or a model that called `process.exit` early.
 * **That is deliberately distinct from 0/N:** "the code failed every test" and "we never learned anything" are
 * different measurements, and collapsing them would record a confident zero for a run that produced no evidence.
 * The eval runner already treats a null score as "no scorable answer".
 */
export function parseImplementHarnessOutput(stdout: string): ImplementHarnessResult | null {
	const index = stdout.lastIndexOf(IMPLEMENT_RESULT_SENTINEL);
	if (index < 0) {
		return null;
	}
	const payload = stdout.slice(index + IMPLEMENT_RESULT_SENTINEL.length).trim();
	try {
		const parsed = JSON.parse(payload) as ImplementHarnessResult;
		if (typeof parsed.passed !== "number" || typeof parsed.total !== "number") {
			return null;
		}
		return {
			passed: Math.max(0, Math.min(parsed.total, parsed.passed)),
			total: parsed.total,
			failures: Array.isArray(parsed.failures) ? parsed.failures : [],
		};
	} catch {
		return null;
	}
}

/**
 * Strip a fenced code block if the model wrapped its answer in one.
 *
 * Small models fence their code far more often than not, and an unstripped fence is a definition-time syntax
 * error — which would score 0 and read as "the model cannot implement this" when it merely formatted its reply.
 * That is a measurement error, not a model failure, so it is corrected here rather than counted.
 */
export function extractImplementCode(reply: string): string {
	const fenced = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/u.exec(reply);
	return (fenced?.[1] ?? reply).trim();
}
