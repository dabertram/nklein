import { describe, expect, it } from "vitest";
import {
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeWsOrigin,
	isKanbanRuntimeHttps,
} from "../../../src/core/runtime-endpoint";

// §5.V — the http/ws origin builders compose scheme + host + port. Characterized relative to the underlying getters so the
// test locks the composition + the https↔wss scheme mapping without depending on the ambient host/port/tls config.

describe("getKanbanRuntimeOrigin (§5.V coverage)", () => {
	it("is <http|https>://<host>:<port> matching the tls setting", () => {
		const scheme = isKanbanRuntimeHttps() ? "https" : "http";
		expect(getKanbanRuntimeOrigin()).toBe(`${scheme}://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`);
	});
});

describe("getKanbanRuntimeWsOrigin (§5.V coverage)", () => {
	it("is <ws|wss>://<host>:<port> matching the tls setting", () => {
		const scheme = isKanbanRuntimeHttps() ? "wss" : "ws";
		expect(getKanbanRuntimeWsOrigin()).toBe(`${scheme}://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`);
	});

	it("shares the same host:port as the http origin and maps the scheme (http→ws / https→wss)", () => {
		const httpOrigin = getKanbanRuntimeOrigin();
		const wsOrigin = getKanbanRuntimeWsOrigin();
		// Same authority (host:port) regardless of scheme.
		expect(wsOrigin.replace(/^wss?:\/\//, "")).toBe(httpOrigin.replace(/^https?:\/\//, ""));
		// Scheme mapping is consistent.
		expect(wsOrigin.startsWith("wss://")).toBe(httpOrigin.startsWith("https://"));
	});
});
