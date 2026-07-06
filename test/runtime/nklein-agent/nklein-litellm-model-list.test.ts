import { describe, expect, it } from "vitest";
import {
	appendMissingModels,
	hasAuthorizationHeader,
	resolveLiteLlmModelListHeaders,
	resolveLiteLlmModelListItemId,
} from "../../../src/nklein-agent/nklein-litellm-model-list";
import type { SdkProviderSettings } from "../../../src/nklein-agent/sdk-provider-boundary";

describe("hasAuthorizationHeader (§5.U extraction)", () => {
	it("detects an Authorization header case-insensitively", () => {
		expect(hasAuthorizationHeader({ authorization: "Bearer x" })).toBe(true);
		expect(hasAuthorizationHeader({ AUTHORIZATION: "Bearer x" })).toBe(true);
		expect(hasAuthorizationHeader({ Authorization: "Bearer x" })).toBe(true);
	});

	it("is false when no authorization header is present", () => {
		expect(hasAuthorizationHeader({})).toBe(false);
		expect(hasAuthorizationHeader({ "content-type": "application/json" })).toBe(false);
	});
});

describe("resolveLiteLlmModelListHeaders (§5.U extraction)", () => {
	it("adds a Bearer auth header from the visible api key when none is set", () => {
		const headers = resolveLiteLlmModelListHeaders({ provider: "litellm", apiKey: "sk-123" } as SdkProviderSettings);
		expect(headers.Authorization).toBe("Bearer sk-123");
	});

	it("preserves the caller's existing Authorization header (does not clobber it)", () => {
		const headers = resolveLiteLlmModelListHeaders({
			provider: "litellm",
			apiKey: "sk-123",
			headers: { authorization: "Bearer preset" },
		} as SdkProviderSettings);
		// The preset header is kept; no second (differently-cased) Authorization is added.
		expect(headers.authorization).toBe("Bearer preset");
		expect(headers.Authorization).toBeUndefined();
	});

	it("returns just the caller headers when there is no visible api key", () => {
		const headers = resolveLiteLlmModelListHeaders({
			provider: "litellm",
			headers: { "x-trace": "1" },
		} as SdkProviderSettings);
		expect(headers).toEqual({ "x-trace": "1" });
	});
});

describe("resolveLiteLlmModelListItemId (§5.U extraction)", () => {
	it("prefers model_name on /model/info, falling back to id, and trims", () => {
		expect(resolveLiteLlmModelListItemId({ model_name: "  gpt-oss  ", id: "raw" }, "/model/info")).toBe("gpt-oss");
		expect(resolveLiteLlmModelListItemId({ id: "  only-id  " }, "/model/info")).toBe("only-id");
	});

	it("uses id on /models and yields '' when neither is present", () => {
		expect(resolveLiteLlmModelListItemId({ id: "  qwen  ", model_name: "ignored" }, "/models")).toBe("qwen");
		expect(resolveLiteLlmModelListItemId({}, "/models")).toBe("");
	});
});

describe("appendMissingModels (§5.U extraction)", () => {
	it("backfills only fallback models whose id is not already present, preserving order", () => {
		const merged = appendMissingModels(
			[{ id: "a", name: "A" }],
			[
				{ id: "a", name: "A-dup" },
				{ id: "b", name: "B" },
			],
		);
		expect(merged).toEqual([
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		]);
	});

	it("returns the base list unchanged when the fallback adds nothing new", () => {
		expect(appendMissingModels([{ id: "a", name: "A" }], [{ id: "a", name: "A" }])).toEqual([{ id: "a", name: "A" }]);
	});
});
