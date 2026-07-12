import { afterEach, describe, expect, it } from "vitest";
import {
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	isKanbanRemoteHost,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
	setKanbanRuntimePublicHost,
} from "../../../src/core/runtime-endpoint";
import { normalizeRequestPath } from "../../../src/server/assets";
import { evaluateHost, getAllowedHostHeaders, getAllowedRuntimeOrigins } from "../../../src/server/middleware";

const originalRuntimeHost = getKanbanRuntimeHost();
const originalRuntimePort = getKanbanRuntimePort();
const originalPublicHost = process.env.NKLEIN_RUNTIME_PUBLIC_HOST;

afterEach(() => {
	setKanbanRuntimeHost(originalRuntimeHost);
	setKanbanRuntimePort(originalRuntimePort);
	setKanbanRuntimePublicHost(originalPublicHost ?? null);
});

describe("normalizeRequestPath (§5.V coverage)", () => {
	it("maps the root to /index.html", () => {
		expect(normalizeRequestPath("/")).toBe("/index.html");
	});

	it("strips a query string and decodes percent-encoding", () => {
		expect(normalizeRequestPath("/assets/app.js?v=123")).toBe("/assets/app.js");
		expect(normalizeRequestPath("/a%20b/c.txt")).toBe("/a b/c.txt");
	});

	it("passes a plain path through unchanged", () => {
		expect(normalizeRequestPath("/index.html")).toBe("/index.html");
		expect(normalizeRequestPath("/favicon.ico")).toBe("/favicon.ico");
	});
});

describe("getAllowedHostHeaders (§5.V coverage)", () => {
	it("returns a non-empty allow-list whose every entry is host:<runtime-port>", () => {
		const port = getKanbanRuntimePort();
		const allowed = getAllowedHostHeaders();
		expect(allowed.size).toBeGreaterThan(0);
		for (const entry of allowed) {
			expect(entry.endsWith(`:${port}`)).toBe(true);
		}
	});

	it("allows the loopback hosts on the runtime port when bound locally", () => {
		if (isKanbanRemoteHost()) {
			return; // exercised for the local bind; the remote-bind loopback entries are asserted below
		}
		const port = getKanbanRuntimePort();
		const allowed = getAllowedHostHeaders();
		expect(allowed.has(`localhost:${port}`)).toBe(true);
		expect(allowed.has(`127.0.0.1:${port}`)).toBe(true);
	});

	it("allows the advertised LAN host for wildcard binds without accepting arbitrary host headers", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePublicHost("192.168.1.25");
		setKanbanRuntimePort(4567);
		const allowed = getAllowedHostHeaders();
		expect(allowed.has("0.0.0.0:4567")).toBe(true);
		expect(allowed.has("192.168.1.25:4567")).toBe(true);
		expect(evaluateHost({ hostHeader: "192.168.1.25:4567", allowedHosts: allowed })).toEqual({ kind: "allow" });
		expect(evaluateHost({ hostHeader: "evil.example:4567", allowedHosts: allowed })).toEqual({
			kind: "reject",
			host: "evil.example:4567",
		});
	});

	it("keeps same-machine access first-class on a remote bind (loopback Host headers allowed)", () => {
		// § desktop app #2: the desktop shell loads the UI via 127.0.0.1 while the runtime
		// listens on the wildcard, and a host-machine browser uses localhost.
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePublicHost("192.168.1.25");
		setKanbanRuntimePort(4567);
		const allowed = getAllowedHostHeaders();
		expect(allowed.has("127.0.0.1:4567")).toBe(true);
		expect(allowed.has("localhost:4567")).toBe(true);
		expect(allowed.has("[::1]:4567")).toBe(true);
		// Still no arbitrary hosts: the DNS-rebinding defence is unchanged.
		expect(evaluateHost({ hostHeader: "evil.example:4567", allowedHosts: allowed })).toEqual({
			kind: "reject",
			host: "evil.example:4567",
		});
	});
});

describe("getAllowedRuntimeOrigins (§ desktop app #2 — LAN serving)", () => {
	it("mirrors the allowed hosts as http origins (loopback + bound + advertised on a remote bind)", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePublicHost("192.168.1.25");
		setKanbanRuntimePort(4567);
		const origins = getAllowedRuntimeOrigins();
		expect(origins.has("http://127.0.0.1:4567")).toBe(true);
		expect(origins.has("http://0.0.0.0:4567")).toBe(true);
		expect(origins.has("http://192.168.1.25:4567")).toBe(true);
		expect(origins.has("http://192.168.1.99:4567")).toBe(false);
	});
});
