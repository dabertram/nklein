import { describe, expect, it } from "vitest";
import {
	parseNKleinDeviceAuthCompleteRequest,
	parseNKleinMcpOAuthRequest,
	parseNKleinOauthLoginRequest,
	parseSelfImprovementProjectRequest,
} from "../../../src/core/api-validation";

// §5.V — oauth / mcp / self-improvement tRPC parsers: characterizing serverName emptiness, the baseUrl "trim → null"
// normalization (blank string becomes null; a real null/absent is preserved), and the optional self-improvement payload.

describe("parseNKleinMcpOAuthRequest (§5.V coverage)", () => {
	it("trims serverName and rejects blank", () => {
		expect(parseNKleinMcpOAuthRequest({ serverName: "  github  " })).toEqual({ serverName: "github" });
		expect(() => parseNKleinMcpOAuthRequest({ serverName: "   " })).toThrow(/MCP server name cannot be empty/);
	});
});

describe("parseNKleinOauthLoginRequest (§5.V coverage)", () => {
	it("normalizes a blank baseUrl to null and trims a real one, keeping the provider", () => {
		expect(parseNKleinOauthLoginRequest({ provider: "nklein", baseUrl: "  " })).toEqual({
			provider: "nklein",
			baseUrl: null,
		});
		expect(parseNKleinOauthLoginRequest({ provider: "oca", baseUrl: "  http://x  " })).toEqual({
			provider: "oca",
			baseUrl: "http://x",
		});
	});

	it("preserves an explicit null / omitted baseUrl and rejects an invalid provider", () => {
		expect(parseNKleinOauthLoginRequest({ provider: "openai-codex", baseUrl: null })).toEqual({
			provider: "openai-codex",
			baseUrl: null,
		});
		expect(() => parseNKleinOauthLoginRequest({ provider: "bogus" })).toThrow();
	});
});

describe("parseNKleinDeviceAuthCompleteRequest (§5.V coverage)", () => {
	it("normalizes baseUrl and preserves the device-flow fields", () => {
		expect(
			parseNKleinDeviceAuthCompleteRequest({
				deviceCode: "dc",
				expiresInSeconds: 900,
				pollIntervalSeconds: 5,
				baseUrl: "  http://x  ",
			}),
		).toEqual({ deviceCode: "dc", expiresInSeconds: 900, pollIntervalSeconds: 5, baseUrl: "http://x" });
	});
});

describe("parseSelfImprovementProjectRequest (§5.V coverage)", () => {
	it("trims notes/evidenceBundlePath to undefined when blank and passes confirmSelfProject through", () => {
		expect(
			parseSelfImprovementProjectRequest({ notes: "  hi  ", evidenceBundlePath: "  ", confirmSelfProject: true }),
		).toEqual({ notes: "hi", evidenceBundlePath: undefined, confirmSelfProject: true });
	});

	it("returns undefined for an absent payload (schema is optional)", () => {
		expect(parseSelfImprovementProjectRequest(undefined)).toBeUndefined();
	});
});
