import { describe, expect, it } from "vitest";
import {
	parseGitCheckoutRequest,
	parseNKleinAddProviderRequest,
	parseProjectAddRequest,
	parseWorkspaceFileSearchRequest,
} from "../../../src/core/api-validation";

describe("parseProjectAddRequest — path/gitUrl cross-field rule + trimming", () => {
	it("rejects a payload with neither path nor gitUrl", () => {
		expect(() => parseProjectAddRequest({})).toThrow(/path or gitUrl/i);
	});

	it("rejects a whitespace-only path with no gitUrl (trim-check is stricter than the schema refine)", () => {
		expect(() => parseProjectAddRequest({ path: "   " })).toThrow(/path or gitUrl/i);
	});

	it("trims path/ref/projectName and leaves the other field undefined", () => {
		const req = parseProjectAddRequest({ path: "  /repo  ", ref: "  main  ", projectName: "  My App  " });
		expect(req.path).toBe("/repo");
		expect(req.ref).toBe("main");
		expect(req.projectName).toBe("My App");
		expect(req.gitUrl).toBeUndefined();
	});

	it("accepts a gitUrl-only payload", () => {
		const req = parseProjectAddRequest({ gitUrl: "https://example.com/r.git" });
		expect(req.gitUrl).toBe("https://example.com/r.git");
		expect(req.path).toBeUndefined();
	});
});

describe("parseNKleinAddProviderRequest — slugification, model dedup, model-or-source rule", () => {
	const base = { providerId: "p", name: "N", baseUrl: "http://x", models: ["m"] };

	it("slugifies the providerId (lowercase, spaces → hyphens)", () => {
		const req = parseNKleinAddProviderRequest({ ...base, providerId: "My Provider" });
		expect(req.providerId).toBe("my-provider");
	});

	it("trims, filters empties, and de-duplicates models", () => {
		const req = parseNKleinAddProviderRequest({ ...base, models: ["a", " a ", "b", "", "  "] });
		expect(req.models).toEqual(["a", "b"]);
	});

	it("rejects when there are no models and no modelsSourceUrl", () => {
		expect(() => parseNKleinAddProviderRequest({ ...base, models: [] })).toThrow(/at least one model/i);
	});

	it("accepts an empty model list when a modelsSourceUrl is provided", () => {
		const req = parseNKleinAddProviderRequest({ ...base, models: [], modelsSourceUrl: "  http://src  " });
		expect(req.models).toEqual([]);
		expect(req.modelsSourceUrl).toBe("http://src");
	});

	it("rejects an empty (whitespace) provider name", () => {
		expect(() => parseNKleinAddProviderRequest({ ...base, name: "   " })).toThrow(/name cannot be empty/i);
	});
});

describe("parseGitCheckoutRequest — trim + non-empty", () => {
	it("trims the branch", () => {
		expect(parseGitCheckoutRequest({ branch: "  feature/x  " })).toEqual({ branch: "feature/x" });
	});

	it("rejects a whitespace-only branch", () => {
		expect(() => parseGitCheckoutRequest({ branch: "   " })).toThrow(/branch cannot be empty/i);
	});
});

describe("parseWorkspaceFileSearchRequest — empty-query short-circuit + limit parsing", () => {
	it("returns an empty query when q is blank (no limit parsing attempted)", () => {
		expect(parseWorkspaceFileSearchRequest(new URLSearchParams(""))).toEqual({ query: "" });
		expect(parseWorkspaceFileSearchRequest(new URLSearchParams("q=%20%20"))).toEqual({ query: "" });
	});

	it("trims the query and omits limit when none is given", () => {
		const req = parseWorkspaceFileSearchRequest(new URLSearchParams("q=%20foo%20"));
		expect(req.query).toBe("foo");
		expect(req.limit).toBeUndefined();
	});

	it("parses a positive integer limit", () => {
		const req = parseWorkspaceFileSearchRequest(new URLSearchParams("q=foo&limit=25"));
		expect(req.limit).toBe(25);
	});

	it("rejects a non-positive / non-integer limit", () => {
		expect(() => parseWorkspaceFileSearchRequest(new URLSearchParams("q=foo&limit=0"))).toThrow(/limit/i);
		expect(() => parseWorkspaceFileSearchRequest(new URLSearchParams("q=foo&limit=abc"))).toThrow(/limit/i);
	});
});
