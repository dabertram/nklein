import { describe, expect, it } from "vitest";
import {
	decideTestDrivenDelivery,
	isLikelyTestFile,
	resolveEffectiveTestDrivenMode,
	TEST_DRIVEN_MODE_DEFAULT,
} from "../../../src/core/test-driven-delivery";

describe("isLikelyTestFile", () => {
	it("recognizes .test./.spec. infix files across extensions", () => {
		expect(isLikelyTestFile("src/core/foo.test.ts")).toBe(true);
		expect(isLikelyTestFile("web-ui/src/x.spec.tsx")).toBe(true);
		expect(isLikelyTestFile("a/b.test.js")).toBe(true);
	});
	it("recognizes test directories + go/py suffixes", () => {
		expect(isLikelyTestFile("src/__tests__/x.ts")).toBe(true);
		expect(isLikelyTestFile("test/runtime/core/x.ts")).toBe(true);
		expect(isLikelyTestFile("tests/e2e/x.ts")).toBe(true);
		expect(isLikelyTestFile("pkg/foo_test.go")).toBe(true);
		expect(isLikelyTestFile("app/thing_test.py")).toBe(true);
	});
	it("does NOT match plain source files (or empty)", () => {
		expect(isLikelyTestFile("src/core/foo.ts")).toBe(false);
		expect(isLikelyTestFile("web-ui/src/component.tsx")).toBe(false);
		expect(isLikelyTestFile("README.md")).toBe(false);
		expect(isLikelyTestFile("  ")).toBe(false);
	});
	it("is case/separator tolerant", () => {
		expect(isLikelyTestFile("SRC\\Core\\Foo.Test.TS")).toBe(true);
	});
});

describe("decideTestDrivenDelivery", () => {
	it("disabled ⇒ always allows review (byte-identical to no gate)", () => {
		const d = decideTestDrivenDelivery({ enabled: false, changedFilePaths: ["src/x.ts"] });
		expect(d.allowReview).toBe(true);
		expect(d.reason).toBe("");
	});
	it("enabled + a test change ⇒ allowed", () => {
		const d = decideTestDrivenDelivery({ enabled: true, changedFilePaths: ["src/x.ts", "test/x.test.ts"] });
		expect(d.allowReview).toBe(true);
		expect(d.changedTests).toBe(true);
	});
	it("enabled + no test change ⇒ blocked with an actionable reason", () => {
		const d = decideTestDrivenDelivery({ enabled: true, changedFilePaths: ["src/x.ts", "src/y.ts"] });
		expect(d.allowReview).toBe(false);
		expect(d.changedTests).toBe(false);
		expect(d.reason).toMatch(/test-driven mode/i);
	});
	it("enabled + empty change ⇒ blocked", () => {
		expect(decideTestDrivenDelivery({ enabled: true, changedFilePaths: [] }).allowReview).toBe(false);
	});
});

describe("resolveEffectiveTestDrivenMode (F1.34)", () => {
	it("the default is explicit and ON (David 2026-07-23: testable work ships with tests by default)", () => {
		expect(TEST_DRIVEN_MODE_DEFAULT).toBe(true);
		expect(resolveEffectiveTestDrivenMode(undefined, undefined)).toBe(true);
		expect(resolveEffectiveTestDrivenMode(undefined, null)).toBe(true);
	});
	it("the per-project override wins in BOTH directions (a project can opt out of a global ON)", () => {
		expect(resolveEffectiveTestDrivenMode(false, true)).toBe(true);
		expect(resolveEffectiveTestDrivenMode(true, false)).toBe(false);
	});
	it("an EXPLICIT global false is honored as a real opt-out (not clobbered by the ON default)", () => {
		expect(resolveEffectiveTestDrivenMode(false, undefined)).toBe(false);
		expect(resolveEffectiveTestDrivenMode(false, null)).toBe(false);
	});
	it("null/omitted override inherits the global setting", () => {
		expect(resolveEffectiveTestDrivenMode(true, null)).toBe(true);
		expect(resolveEffectiveTestDrivenMode(false, null)).toBe(false);
		expect(resolveEffectiveTestDrivenMode(true, undefined)).toBe(true);
	});
});

describe("upfront testability declaration (F1.34b-ext, David 2026-07-23)", () => {
	it("a declared not_testable card passes the enabled gate WITHOUT tests, audibly (skippedNonTestable)", () => {
		const d = decideTestDrivenDelivery({
			enabled: true,
			changedFilePaths: ["docs/readme.md"],
			testability: "not_testable",
		});
		expect(d.allowReview).toBe(true);
		expect(d.skippedNonTestable).toBe(true);
		expect(d.reason).toBe("");
	});
	it("an explicit testable declaration behaves exactly like the absent default (gated)", () => {
		const declared = decideTestDrivenDelivery({
			enabled: true,
			changedFilePaths: ["src/x.ts"],
			testability: "testable",
		});
		const defaulted = decideTestDrivenDelivery({ enabled: true, changedFilePaths: ["src/x.ts"] });
		expect(declared.allowReview).toBe(false);
		expect(declared.skippedNonTestable).toBe(false);
		expect(declared.reason).toBe(defaulted.reason);
	});
	it("a disabled gate never reports a non-testable skip (nothing was skipped — there was no gate)", () => {
		const d = decideTestDrivenDelivery({
			enabled: false,
			changedFilePaths: ["docs/readme.md"],
			testability: "not_testable",
		});
		expect(d.allowReview).toBe(true);
		expect(d.skippedNonTestable).toBe(false);
	});
	it("the bounce reason tells the agent the declaration is the remedy for genuinely non-testable work, not a workaround", () => {
		const d = decideTestDrivenDelivery({ enabled: true, changedFilePaths: ["src/x.ts"] });
		expect(d.reason).toMatch(/not_testable/);
	});
});

describe("no identical-loop churn (F1.34)", () => {
	it("a test-backed change passes cleanly while the SAME testless change is blocked with a byte-identical reason every time — the identical-feedback park guard's precondition", () => {
		const testless = ["src/a.ts", "src/b.ts"];
		const first = decideTestDrivenDelivery({ enabled: true, changedFilePaths: testless });
		const second = decideTestDrivenDelivery({ enabled: true, changedFilePaths: testless });
		expect(first.allowReview).toBe(false);
		expect(second.reason).toBe(first.reason); // deterministic ⇒ repeat testless bounces trip the park guard, never loop
		const backed = decideTestDrivenDelivery({ enabled: true, changedFilePaths: [...testless, "test/a.test.ts"] });
		expect(backed.allowReview).toBe(true);
		expect(backed.reason).toBe("");
	});
});
