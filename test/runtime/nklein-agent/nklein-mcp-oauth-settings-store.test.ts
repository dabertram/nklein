import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	hasAccessToken,
	isEmptyOauthServerState,
	normalizeOauthServerState,
	parseOauthSettings,
	resolveMcpOauthSettingsPath,
	updateOauthServerState,
	writeOauthSettings,
} from "../../../src/nklein-agent/nklein-mcp-oauth-settings-store";

const ENV_KEY = "NKLEIN_MCP_OAUTH_SETTINGS_PATH";
let tempDir: string;
let settingsPath: string;
const savedEnv = process.env[ENV_KEY];

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "nklein-mcp-oauth-"));
	settingsPath = join(tempDir, "oauth.json");
});

afterEach(() => {
	if (savedEnv === undefined) {
		delete process.env[ENV_KEY];
	} else {
		process.env[ENV_KEY] = savedEnv;
	}
	rmSync(tempDir, { recursive: true, force: true });
});

describe("normalizeOauthServerState (§5.U extraction)", () => {
	it("keeps present fields and drops absent/falsy ones", () => {
		expect(
			normalizeOauthServerState({
				tokens: { access_token: "x" },
				codeVerifier: "v",
				lastError: undefined,
			}),
		).toEqual({ tokens: { access_token: "x" }, codeVerifier: "v" });
	});

	it("collapses an all-absent state to an empty object", () => {
		expect(normalizeOauthServerState({})).toEqual({});
	});
});

describe("isEmptyOauthServerState (§5.U extraction)", () => {
	it("is true only for an empty state", () => {
		expect(isEmptyOauthServerState({})).toBe(true);
		expect(isEmptyOauthServerState({ codeVerifier: "v" })).toBe(false);
	});
});

describe("hasAccessToken (§5.U extraction)", () => {
	it("is true only for a non-blank string access_token", () => {
		expect(hasAccessToken({ access_token: "abc" })).toBe(true);
		expect(hasAccessToken({ access_token: "   " })).toBe(false);
		expect(hasAccessToken({ access_token: 123 })).toBe(false);
		expect(hasAccessToken({})).toBe(false);
		expect(hasAccessToken(undefined)).toBe(false);
	});
});

describe("resolveMcpOauthSettingsPath (§5.U extraction)", () => {
	it("honors the env override as an absolute path", () => {
		process.env[ENV_KEY] = settingsPath;
		expect(resolveMcpOauthSettingsPath()).toBe(resolve(settingsPath));
	});
});

describe("parseOauthSettings (§5.U extraction)", () => {
	it("returns empty servers when the file is missing", () => {
		expect(parseOauthSettings(settingsPath)).toEqual({ servers: {} });
	});

	it("reads + normalizes a valid file (pruning falsy fields)", () => {
		writeFileSync(
			settingsPath,
			JSON.stringify({ servers: { a: { tokens: { access_token: "t" }, lastError: "" } } }),
			"utf8",
		);
		expect(parseOauthSettings(settingsPath)).toEqual({ servers: { a: { tokens: { access_token: "t" } } } });
	});

	it("throws a path-scoped error on malformed JSON", () => {
		writeFileSync(settingsPath, "{ not json", "utf8");
		expect(() => parseOauthSettings(settingsPath)).toThrow(/Failed to parse MCP OAuth settings JSON/);
	});

	it("throws a validation error on a bad shape", () => {
		writeFileSync(settingsPath, JSON.stringify({ servers: { a: { redirectUrl: "not-a-url" } } }), "utf8");
		expect(() => parseOauthSettings(settingsPath)).toThrow(/Invalid MCP OAuth settings/);
	});
});

describe("writeOauthSettings + updateOauthServerState (§5.U extraction)", () => {
	it("round-trips written settings", async () => {
		await writeOauthSettings(settingsPath, { servers: { a: { codeVerifier: "v" } } });
		expect(parseOauthSettings(settingsPath)).toEqual({ servers: { a: { codeVerifier: "v" } } });
	});

	it("adds a server state transactionally and returns the normalized result", async () => {
		const result = await updateOauthServerState({
			path: settingsPath,
			serverName: "srv",
			updater: () => ({ tokens: { access_token: "t" }, lastError: undefined }),
		});
		expect(result).toEqual({ tokens: { access_token: "t" } });
		expect(parseOauthSettings(settingsPath).servers.srv).toEqual({ tokens: { access_token: "t" } });
	});

	it("prunes the server entry when the updater yields an empty state", async () => {
		await updateOauthServerState({
			path: settingsPath,
			serverName: "srv",
			updater: () => ({ codeVerifier: "v" }),
		});
		await updateOauthServerState({ path: settingsPath, serverName: "srv", updater: () => ({}) });
		expect(parseOauthSettings(settingsPath).servers.srv).toBeUndefined();
	});
});
