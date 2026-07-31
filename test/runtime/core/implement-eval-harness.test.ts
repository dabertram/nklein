import { describe, expect, it } from "vitest";
import {
	buildImplementHarnessScript,
	extractImplementCode,
	IMPLEMENT_RESULT_SENTINEL,
	parseImplementHarnessOutput,
} from "../../../src/core/implement-eval-harness";

/**
 * P22.2 — guards for the harness that executes model-generated code.
 *
 * Weighted toward the distinction that makes the measurement honest: **"failed every test" and "produced no
 * evidence" are different facts.** A crash, a timeout or an early `process.exit` must read as null, not as 0/N —
 * collapsing them would record a confident zero for a run that measured nothing, and that zero would then feed
 * the fitness store as if the model had earned it.
 */
describe("parseImplementHarnessOutput", () => {
	it("reads a result out of stdout even when the candidate printed noise", () => {
		// Model code runs first and can log freely; the sentinel is what separates its chatter from the result.
		const stdout = `debugging...\nmore output\n${IMPLEMENT_RESULT_SENTINEL}{"passed":2,"total":3,"failures":[]}\n`;
		expect(parseImplementHarnessOutput(stdout)).toEqual({ passed: 2, total: 3, failures: [] });
	});

	it("returns NULL when the sentinel is absent — no evidence, not zero", () => {
		for (const stdout of ["", "crashed before reporting", "Segmentation fault"]) {
			expect(parseImplementHarnessOutput(stdout), `input: ${stdout}`).toBeNull();
		}
	});

	it("takes the LAST sentinel, so a candidate cannot forge an earlier result", () => {
		// Model code could print the sentinel itself. The harness writes its payload last, so the last one wins.
		const forged = `${IMPLEMENT_RESULT_SENTINEL}{"passed":99,"total":99,"failures":[]}`;
		const real = `${IMPLEMENT_RESULT_SENTINEL}{"passed":1,"total":3,"failures":[]}`;
		expect(parseImplementHarnessOutput(`${forged}\n${real}`)?.passed).toBe(1);
	});

	it("returns null on a malformed payload rather than guessing", () => {
		expect(parseImplementHarnessOutput(`${IMPLEMENT_RESULT_SENTINEL}not json`)).toBeNull();
		expect(parseImplementHarnessOutput(`${IMPLEMENT_RESULT_SENTINEL}{"passed":"two"}`)).toBeNull();
	});

	it("CLAMPS a passed count that exceeds the total", () => {
		// A candidate that forged an inflated payload must not score above the tests that exist.
		expect(parseImplementHarnessOutput(`${IMPLEMENT_RESULT_SENTINEL}{"passed":50,"total":3,"failures":[]}`)).toEqual({
			passed: 3,
			total: 3,
			failures: [],
		});
	});
});

describe("buildImplementHarnessScript", () => {
	it("captures stdout BEFORE the candidate runs, so redefining console cannot hide the result", () => {
		const script = buildImplementHarnessScript({ code: "// anything", tests: [{ name: "t", assertion: "true" }] });
		expect(script.indexOf("__write")).toBeLessThan(script.indexOf("// anything"));
	});

	it("embeds the candidate at TOP LEVEL — not inside a block, which would break class/let/const", () => {
		// ⚠️ THIS TEST USED TO ASSERT ONLY THAT THE SCRIPT TEXT CONTAINED THE CANDIDATE, and it passed while the
		// harness was BROKEN: the candidate sat inside a `try` block, so `class`/`let`/`const` were block-scoped and
		// invisible to the assertions. `function` survived by hoisting, which is exactly why the bug hid — the
		// simple prompts worked. It was caught by executing the corpus's own reference implementations (0/5 for the
		// class-based prompt), not by any assertion on the script string.
		//
		// So this now checks the STRUCTURAL property that was actually violated: nothing wraps the candidate.
		const script = buildImplementHarnessScript({
			code: "class Thing {}\nconst HELPER = 1;",
			tests: [{ name: "t", assertion: "new Thing() instanceof Thing" }],
		});
		const candidateAt = script.indexOf("class Thing {}");
		expect(candidateAt).toBeGreaterThan(-1);
		// No unclosed `try {` may precede the candidate — that is precisely the shape that block-scoped it.
		const before = script.slice(0, candidateAt);
		expect((before.match(/\btry\s*\{/gu) ?? []).length, "the candidate must not be nested inside a try block").toBe(
			0,
		);
	});

	it("reports a definition-time throw as every test failing, with the reason", () => {
		const script = buildImplementHarnessScript({
			code: "throw new Error('boom')",
			tests: [
				{ name: "a", assertion: "true" },
				{ name: "b", assertion: "true" },
			],
		});
		expect(script).toContain("'(definition)'");
		expect(script).toContain("total: 2");
	});
});

describe("extractImplementCode", () => {
	it("strips a fenced block, which small models add constantly", () => {
		// An unstripped fence is a definition-time syntax error: it would score 0 and read as "cannot implement"
		// when the model merely formatted its reply. That is a measurement error, not a model failure.
		expect(extractImplementCode("Here:\n```js\nfunction f(){}\n```")).toBe("function f(){}");
		expect(extractImplementCode("```\nconst x = 1;\n```")).toBe("const x = 1;");
	});

	it("leaves unfenced code alone", () => {
		expect(extractImplementCode("function f(){ return 1; }")).toBe("function f(){ return 1; }");
	});
});
