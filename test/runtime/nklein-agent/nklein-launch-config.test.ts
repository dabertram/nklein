import { describe, expect, it } from "vitest";
import { normalizeLaunchConfig } from "../../../src/nklein-agent/nklein-launch-config";

describe("normalizeLaunchConfig (§5.U extraction)", () => {
	it("trims + lowercases providerId and trims modelId", () => {
		const out = normalizeLaunchConfig({ providerId: "  LM-Studio  ", modelId: "  Qwen-27B  " });
		expect(out.providerId).toBe("lm-studio");
		expect(out.modelId).toBe("Qwen-27B");
	});

	it("OMITS absent optional fields (absent ⇒ leave unchanged on restart)", () => {
		const out = normalizeLaunchConfig({ providerId: "p", modelId: "m" });
		expect(Object.hasOwn(out, "baseUrl")).toBe(false);
		expect(Object.hasOwn(out, "contextWindow")).toBe(false);
		expect(Object.hasOwn(out, "workspaceRoot")).toBe(false);
		expect(Object.hasOwn(out, "maxAgentWritableFileLines")).toBe(false);
	});

	it("KEEPS a present-but-null field (present ⇒ clear) — distinct from absent", () => {
		const out = normalizeLaunchConfig({ providerId: "p", modelId: "m", contextWindow: null, baseUrl: null });
		expect(Object.hasOwn(out, "contextWindow")).toBe(true);
		expect(out.contextWindow).toBeNull();
		expect(Object.hasOwn(out, "baseUrl")).toBe(true);
		expect(out.baseUrl).toBeNull();
	});

	it("trims baseUrl + workspaceRoot; empty/whitespace ⇒ null", () => {
		const out = normalizeLaunchConfig({
			providerId: "p",
			modelId: "m",
			baseUrl: "  http://host:1234  ",
			workspaceRoot: "   ",
		});
		expect(out.baseUrl).toBe("http://host:1234");
		expect(out.workspaceRoot).toBeNull();
	});

	it("passes filesLikelyTouched + numeric fields through", () => {
		const out = normalizeLaunchConfig({
			providerId: "p",
			modelId: "m",
			filesLikelyTouched: ["a.ts", "b.ts"],
			contextWindow: 40_000,
			maxAgentWritableFileLines: 500,
			apiTimeoutMs: 30_000,
		});
		expect(out.filesLikelyTouched).toEqual(["a.ts", "b.ts"]);
		expect(out.contextWindow).toBe(40_000);
		expect(out.maxAgentWritableFileLines).toBe(500);
		expect(out.apiTimeoutMs).toBe(30_000);
	});

	it("a present-but-undefined filesLikelyTouched normalizes to null (the ?? null branch)", () => {
		const out = normalizeLaunchConfig({ providerId: "p", modelId: "m", filesLikelyTouched: undefined });
		expect(Object.hasOwn(out, "filesLikelyTouched")).toBe(true);
		expect(out.filesLikelyTouched).toBeNull();
	});
});
