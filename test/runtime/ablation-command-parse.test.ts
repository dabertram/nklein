import { describe, expect, it } from "vitest";
import { assessNoOpAblation, type TestOutcome } from "../../src/core/no-op-ablation";

/**
 * P20.3 wire — the JSONL parsing the `dev ablation` command does, and the verdict/exit mapping it relies on.
 * The one that must not slip: `decorative` fails a script (the artifact is fake), while `inconclusive` does not
 * (missing evidence is a harness gap, and failing on it would be a false alarm manufactured from no data).
 */

function parse(text: string): TestOutcome[] {
	const out: TestOutcome[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const p = JSON.parse(t) as { testId?: unknown; passed?: unknown };
			if (typeof p.testId === "string" && typeof p.passed === "boolean")
				out.push({ testId: p.testId, passed: p.passed });
		} catch {
			// skip
		}
	}
	return out;
}

const shouldFailScript = (v: string) => (v === "decorative" ? 1 : 0);

describe("ablation command parsing + exit mapping", () => {
	it("reads one {testId,passed} JSON per line and skips malformed", () => {
		expect(parse('{"testId":"a","passed":true}\n{bad}\n{"testId":"b","passed":false}')).toEqual([
			{ testId: "a", passed: true },
			{ testId: "b", passed: false },
		]);
	});

	it("DECORATIVE exits non-zero — the artifact does nothing the suite measures", () => {
		const v = assessNoOpAblation({
			baseline: [{ testId: "t", passed: true }],
			ablated: [{ testId: "t", passed: true }],
		}).verdict;
		expect(v).toBe("decorative");
		expect(shouldFailScript(v)).toBe(1);
	});

	it("INCONCLUSIVE exits ZERO — missing evidence must not become a false alarm", () => {
		const v = assessNoOpAblation({ baseline: [], ablated: [] }).verdict;
		expect(v).toBe("inconclusive");
		expect(shouldFailScript(v)).toBe(0);
	});

	it("LOAD_BEARING exits zero — the artifact is doing real work", () => {
		const v = assessNoOpAblation({
			baseline: [{ testId: "t", passed: true }],
			ablated: [{ testId: "t", passed: false }],
		}).verdict;
		expect(v).toBe("load_bearing");
		expect(shouldFailScript(v)).toBe(0);
	});
});
