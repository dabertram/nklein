import { describe, expect, it } from "vitest";
import { parseProxyAuthorizationClaims, parseProxyAuthorizationHeader } from "../../src/core/egress-proxy-protocol";
import { buildTaskProxyUrl, createEgressTaskIdentityRegistry } from "../../src/core/egress-task-identity";

const ACCEPTANCE_ID = "s44a-system-clock-split-sc-wallclock-allowlist::acceptance-2";
const TOKEN = "0123456789abcdef0123456789abcdef";

function headWithBasic(userinfo: string): string {
	return (
		"CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n" +
		`Proxy-Authorization: Basic ${Buffer.from(userinfo).toString("base64")}\r\n\r\n`
	);
}

describe("parseProxyAuthorizationClaims (2026-09-06 placement ids with '::')", () => {
	it("recovers the acceptance placement id from the DECODED userinfo npm actually sends", () => {
		// Live capture 2026-09-06: npm percent-decodes the proxy URL userinfo before Basic-encoding it, so the
		// header carried `…::acceptance-2:<token>` with raw colons — a first-colon split yielded taskId "s44a…" only.
		const claims = parseProxyAuthorizationClaims(headWithBasic(`${ACCEPTANCE_ID}:${TOKEN}`));
		expect(claims[0]).toEqual({ taskId: ACCEPTANCE_ID, token: TOKEN });
		const registry = createEgressTaskIdentityRegistry();
		registry.issue(ACCEPTANCE_ID, TOKEN);
		expect(claims.find((claim) => registry.validate(claim.taskId, claim.token))).toEqual({
			taskId: ACCEPTANCE_ID,
			token: TOKEN,
		});
	});

	it("also accepts the still-encoded form a non-decoding client forwards from the runtime's proxy URL", () => {
		const url = new URL(
			buildTaskProxyUrl({ proxyHost: "172.19.0.2", proxyPort: 3129, taskId: ACCEPTANCE_ID, token: TOKEN }),
		);
		expect(url.username).toBe("s44a-system-clock-split-sc-wallclock-allowlist%3A%3Aacceptance-2");
		expect(parseProxyAuthorizationClaims(headWithBasic(`${url.username}:${url.password}`))).toEqual([
			{ taskId: ACCEPTANCE_ID, token: TOKEN },
		]);
	});

	it("lists every split from the last colon backwards, so a token with a colon still has its reading", () => {
		expect(parseProxyAuthorizationClaims(headWithBasic("plain:to:ken"))).toEqual([
			{ taskId: "plain:to", token: "ken" },
			{ taskId: "plain", token: "to:ken" },
		]);
		expect(parseProxyAuthorizationClaims(headWithBasic("plain-task:tok"))).toEqual([
			{ taskId: "plain-task", token: "tok" },
		]);
	});

	it("yields nothing for an absent, malformed, or token-less header", () => {
		expect(parseProxyAuthorizationClaims("CONNECT a:443 HTTP/1.1\r\nHost: a:443\r\n\r\n")).toEqual([]);
		expect(
			parseProxyAuthorizationClaims("CONNECT a:443 HTTP/1.1\r\nProxy-Authorization: Bearer nope\r\n\r\n"),
		).toEqual([]);
		expect(parseProxyAuthorizationClaims(headWithBasic("no-token:"))).toEqual([]);
		expect(parseProxyAuthorizationClaims(headWithBasic(":only-token"))).toEqual([]);
	});
});

describe("parseProxyAuthorizationHeader (first-colon reading, kept for plain ids)", () => {
	it("decodes a percent-encoded claim and keeps a malformed escape verbatim", () => {
		expect(parseProxyAuthorizationHeader(headWithBasic("s44a%3A%3Aacceptance-2:tok"))).toEqual({
			taskId: "s44a::acceptance-2",
			token: "tok",
		});
		expect(parseProxyAuthorizationHeader(headWithBasic("bad%E0%A4%A:tok%ZZ"))).toEqual({
			taskId: "bad%E0%A4%A",
			token: "tok%ZZ",
		});
		expect(parseProxyAuthorizationHeader(headWithBasic("no-token:"))).toBeNull();
	});
});
