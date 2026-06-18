import { describe, expect, it, vi } from "vitest";
import {
	KANBAN_PROTOCOL,
	OAUTH_CALLBACK_PATH,
	type ElectronAppLike,
	extractProtocolUrlFromArgv,
	parseProtocolUrl,
	registerProtocol,
} from "../src/protocol-handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("Constants", () => {
	it("KANBAN_PROTOCOL is 'nklein'", () => {
		expect(KANBAN_PROTOCOL).toBe("nklein");
	});

	it("OAUTH_CALLBACK_PATH is '/oauth/callback'", () => {
		expect(OAUTH_CALLBACK_PATH).toBe("/oauth/callback");
	});
});

// ---------------------------------------------------------------------------
// parseProtocolUrl
// ---------------------------------------------------------------------------

describe("parseProtocolUrl", () => {
	it("returns null for an invalid URL", () => {
		expect(parseProtocolUrl("not a url")).toBeNull();
	});

	it("returns null for a non-nklein protocol", () => {
		expect(parseProtocolUrl("https://example.com/oauth/callback")).toBeNull();
	});

	it("returns null for http:// URLs", () => {
		expect(parseProtocolUrl("http://oauth/callback?code=abc")).toBeNull();
	});

	it("parses a basic nklein:// URL", () => {
		const result = parseProtocolUrl("nklein://oauth/callback");
		expect(result).not.toBeNull();
		expect(result!.raw).toBe("nklein://oauth/callback");
		expect(result!.pathname).toBe("/oauth/callback");
		expect(result!.isOAuthCallback).toBe(true);
	});

	it("sets isOAuthCallback to false for non-callback paths", () => {
		const result = parseProtocolUrl("nklein://settings/general");
		expect(result).not.toBeNull();
		expect(result!.pathname).toBe("/settings/general");
		expect(result!.isOAuthCallback).toBe(false);
	});

	it("normalises the root path", () => {
		const result = parseProtocolUrl("nklein://");
		expect(result).not.toBeNull();
		expect(result!.pathname).toBe("/");
		expect(result!.isOAuthCallback).toBe(false);
	});

	it("preserves all search params in the searchParams map", () => {
		const result = parseProtocolUrl(
			"nklein://oauth/callback?code=c&state=s&extra=foo",
		);
		expect(result).not.toBeNull();
		expect(result!.searchParams.get("code")).toBe("c");
		expect(result!.searchParams.get("state")).toBe("s");
		expect(result!.searchParams.get("extra")).toBe("foo");
	});

	it("handles trailing slash on the callback path", () => {
		const result = parseProtocolUrl("nklein://oauth/callback/?code=123");
		expect(result).not.toBeNull();
		expect(result!.pathname).toBe("/oauth/callback");
		expect(result!.isOAuthCallback).toBe(true);
		expect(result!.searchParams.get("code")).toBe("123");
	});

	it("URL-decodes search parameter values", () => {
		const result = parseProtocolUrl(
			"nklein://oauth/callback?error_description=Something%20went%20wrong%21",
		);
		expect(result).not.toBeNull();
		expect(result!.searchParams.get("error_description")).toBe(
			"Something went wrong!",
		);
	});
});

// ---------------------------------------------------------------------------
// registerProtocol
// ---------------------------------------------------------------------------

describe("registerProtocol", () => {
	it("calls setAsDefaultProtocolClient when not already registered", () => {
		const mockApp: ElectronAppLike = {
			setAsDefaultProtocolClient: vi.fn().mockReturnValue(true),
			isDefaultProtocolClient: vi.fn().mockReturnValue(false),
		};

		const result = registerProtocol(mockApp);

		expect(mockApp.isDefaultProtocolClient).toHaveBeenCalledWith("nklein");
		expect(mockApp.setAsDefaultProtocolClient).toHaveBeenCalledWith("nklein");
		expect(result).toBe(true);
	});

	it("skips setAsDefaultProtocolClient when already registered", () => {
		const mockApp: ElectronAppLike = {
			setAsDefaultProtocolClient: vi.fn().mockReturnValue(true),
			isDefaultProtocolClient: vi.fn().mockReturnValue(true),
		};

		const result = registerProtocol(mockApp);

		expect(mockApp.isDefaultProtocolClient).toHaveBeenCalledWith("nklein");
		expect(mockApp.setAsDefaultProtocolClient).not.toHaveBeenCalled();
		expect(result).toBe(true);
	});

	it("returns false when registration fails", () => {
		const mockApp: ElectronAppLike = {
			setAsDefaultProtocolClient: vi.fn().mockReturnValue(false),
			isDefaultProtocolClient: vi.fn().mockReturnValue(false),
		};

		const result = registerProtocol(mockApp);

		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// extractProtocolUrlFromArgv
// ---------------------------------------------------------------------------

describe("extractProtocolUrlFromArgv", () => {
	it("returns the nklein:// URL from argv", () => {
		const argv = [
			"/usr/bin/nklein",
			"--some-flag",
			"nklein://oauth/callback?code=abc",
		];
		expect(extractProtocolUrlFromArgv(argv)).toBe(
			"nklein://oauth/callback?code=abc",
		);
	});

	it("returns the first nklein:// URL if there are multiple", () => {
		const argv = ["nklein://first", "nklein://second"];
		expect(extractProtocolUrlFromArgv(argv)).toBe("nklein://first");
	});

	it("returns null when no nklein:// URL is present", () => {
		const argv = ["/usr/bin/nklein", "--flag", "https://example.com"];
		expect(extractProtocolUrlFromArgv(argv)).toBeNull();
	});

	it("returns null for an empty argv", () => {
		expect(extractProtocolUrlFromArgv([])).toBeNull();
	});

	it("does not match nklein: without //", () => {
		const argv = ["nklein:something"];
		expect(extractProtocolUrlFromArgv(argv)).toBeNull();
	});

	it("does not match nklein:// when embedded in another argument", () => {
		const argv = ["--url=nklein://foo"];
		expect(extractProtocolUrlFromArgv(argv)).toBeNull();
	});
});
