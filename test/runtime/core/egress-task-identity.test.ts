import { describe, expect, it } from "vitest";
import { parseProxyAuthorizationHeader } from "../../../src/core/egress-proxy-protocol";
import { buildTaskProxyUrl, createEgressTaskIdentityRegistry } from "../../../src/core/egress-task-identity";

/**
 * F2.5 — per-task egress attribution cores: the Proxy-Authorization claim parser (attribution-only, malformed
 * never throws), the identity registry (issue/validate/revoke), and the credentialed proxy URL builder.
 */

function basicHead(credentials: string): string {
	const encoded = Buffer.from(credentials, "latin1").toString("base64");
	return `CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\nProxy-Authorization: Basic ${encoded}\r\n\r\n`;
}

describe("parseProxyAuthorizationHeader", () => {
	it("extracts a Basic taskId:token claim (case-insensitive header + scheme; first colon splits)", () => {
		expect(parseProxyAuthorizationHeader(basicHead("task-42:tok:with:colons"))).toEqual({
			taskId: "task-42",
			token: "tok:with:colons",
		});
		const lower = basicHead("t:k").replace("Proxy-Authorization: Basic", "proxy-authorization: basic");
		expect(parseProxyAuthorizationHeader(lower)).toEqual({ taskId: "t", token: "k" });
	});

	it("returns null for absent/malformed claims without affecting anything", () => {
		expect(parseProxyAuthorizationHeader("CONNECT a:443 HTTP/1.1\r\n\r\n")).toBeNull();
		expect(parseProxyAuthorizationHeader(basicHead("no-colon-here"))).toBeNull();
		expect(parseProxyAuthorizationHeader(basicHead(":empty-task"))).toBeNull();
		const bearer = basicHead("t:k").replace("Basic", "Bearer");
		expect(parseProxyAuthorizationHeader(bearer)).toBeNull();
	});
});

describe("createEgressTaskIdentityRegistry", () => {
	it("validates exactly the issued pair; revoke and wrong tokens fail", () => {
		const registry = createEgressTaskIdentityRegistry();
		registry.issue("task-1", "secret-token");
		expect(registry.validate("task-1", "secret-token")).toBe(true);
		expect(registry.validate("task-1", "secret-tokeN")).toBe(false);
		expect(registry.validate("task-2", "secret-token")).toBe(false);
		registry.revoke("task-1");
		expect(registry.validate("task-1", "secret-token")).toBe(false);
	});
});

describe("buildTaskProxyUrl", () => {
	it("URL-encodes components so standard clients emit the Proxy-Authorization automatically", () => {
		expect(buildTaskProxyUrl({ proxyHost: "172.20.0.2", proxyPort: 3129, taskId: "task/1", token: "a:b c" })).toBe(
			"http://task%2F1:a%3Ab%20c@172.20.0.2:3129",
		);
	});
});
