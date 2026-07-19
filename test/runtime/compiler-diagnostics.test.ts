import { describe, expect, it } from "vitest";
import {
	diagnosticsSignature,
	parseCompilerDiagnostics,
	planTypeCheckRepair,
} from "../../src/core/compiler-diagnostics";

describe("compiler diagnostics (F12.86)", () => {
	it("parses tsc errors with code and location", () => {
		const output = [
			"src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
			"src/foo.ts(19,1): error TS2304: Cannot find name 'bar'.",
			"src/foo.ts(3,1): warning TS6133: 'x' is declared but never read.",
		].join("\n");
		const diagnostics = parseCompilerDiagnostics(output, "typescript");
		// Warnings never gate a repair loop.
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]).toEqual({
			file: "src/foo.ts",
			line: 12,
			column: 5,
			code: "TS2322",
			message: "Type 'string' is not assignable to type 'number'.",
		});
	});

	it("pairs rust message lines with their --> location", () => {
		const output = [
			"error[E0308]: mismatched types",
			"  --> src/main.rs:4:18",
			"   |",
			"4  |     let x: u8 = y;",
		].join("\n");
		const diagnostics = parseCompilerDiagnostics(output, "rust");
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			file: "src/main.rs",
			line: 4,
			column: 18,
			code: "E0308",
			message: "mismatched types",
		});
	});

	it("parses go and java shapes", () => {
		expect(parseCompilerDiagnostics("./main.go:7:2: undefined: fmt", "go")[0]).toMatchObject({
			file: "./main.go",
			line: 7,
			column: 2,
			message: "undefined: fmt",
		});
		expect(parseCompilerDiagnostics("Foo.java:5: error: cannot find symbol", "java")[0]).toMatchObject({
			file: "Foo.java",
			line: 5,
			message: "cannot find symbol",
		});
	});

	it("returns nothing for unrecognized output rather than guessing", () => {
		expect(parseCompilerDiagnostics("everything is fine\n\n", "typescript")).toEqual([]);
		expect(parseCompilerDiagnostics("", "rust")).toEqual([]);
	});

	it("skips the repair round when the check is clean", () => {
		const plan = planTypeCheckRepair({ diagnostics: [], attempt: 0 });
		expect(plan.repair).toBe(false);
		expect(plan.reason).toContain("clean");
	});

	it("builds a bounded, anchored repair instruction", () => {
		const diagnostics = parseCompilerDiagnostics(
			[
				"src/a.ts(1,1): error TS1: one",
				"src/b.ts(2,1): error TS2: two",
				"src/c.ts(3,1): error TS3: three",
				"src/d.ts(4,1): error TS4: four",
				"src/e.ts(5,1): error TS5: five",
				"src/f.ts(6,1): error TS6: six",
			].join("\n"),
			"typescript",
		);
		const plan = planTypeCheckRepair({ diagnostics, attempt: 0, maxNamed: 5 });
		expect(plan.repair).toBe(true);
		expect(plan.instruction).toContain("src/a.ts:1 [TS1]: one");
		expect(plan.instruction).toContain("(+1 more of the same run)");
		expect(plan.instruction).toContain("do not run tests yet");
		expect(plan.reason).toContain("repair round 1/2");
	});

	it("stops at the attempt cap instead of grinding", () => {
		const diagnostics = parseCompilerDiagnostics("src/a.ts(1,1): error TS1: one", "typescript");
		const plan = planTypeCheckRepair({ diagnostics, attempt: 2, maxAttempts: 2 });
		expect(plan.repair).toBe(false);
		expect(plan.reason).toContain("cap reached");
		expect(plan.reason).toContain("escalate");
	});

	it("stops when the SAME errors come back (no progress)", () => {
		const diagnostics = parseCompilerDiagnostics("src/a.ts(1,1): error TS1: one", "typescript");
		const signature = diagnosticsSignature(diagnostics);
		const plan = planTypeCheckRepair({ diagnostics, attempt: 1, previousSignature: signature });
		expect(plan.repair).toBe(false);
		expect(plan.reason).toContain("no progress");
	});

	it("signatures are order-insensitive so re-ordered output is not mistaken for progress", () => {
		const first = parseCompilerDiagnostics(
			["src/a.ts(1,1): error TS1: one", "src/b.ts(2,1): error TS2: two"].join("\n"),
			"typescript",
		);
		const reordered = parseCompilerDiagnostics(
			["src/b.ts(2,1): error TS2: two", "src/a.ts(1,1): error TS1: one"].join("\n"),
			"typescript",
		);
		expect(diagnosticsSignature(first)).toBe(diagnosticsSignature(reordered));
	});
});
