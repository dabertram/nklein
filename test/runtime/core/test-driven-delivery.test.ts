import { describe, expect, it } from "vitest";
import { decideTestDrivenDelivery, isLikelyTestFile } from "../../../src/core/test-driven-delivery";

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
