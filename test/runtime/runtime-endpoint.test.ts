import { afterEach, describe, expect, it } from "vitest";
import { resetLegacyEnvWarningsForTests } from "../../src/config/legacy-env";

import {
	buildKanbanRuntimeUrl,
	buildKanbanRuntimeWsUrl,
	clearKanbanRuntimeTls,
	DEFAULT_KANBAN_RUNTIME_PORT,
	getKanbanRuntimeAdvertisedHost,
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	getKanbanRuntimePublicHost,
	getRuntimeFetch,
	isKanbanRuntimeHttps,
	normalizeRuntimePublicHost,
	parseRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
	setKanbanRuntimePublicHost,
	setKanbanRuntimeTls,
} from "../../src/core/runtime-endpoint";

const originalRuntimePort = getKanbanRuntimePort();
const originalRuntimeHost = getKanbanRuntimeHost();
const originalEnvPort = process.env.NKLEIN_RUNTIME_PORT;
const originalLegacyEnvPort = process.env.KANBAN_RUNTIME_PORT;
const originalEnvHost = process.env.NKLEIN_RUNTIME_HOST;
const originalEnvPublicHost = process.env.NKLEIN_RUNTIME_PUBLIC_HOST;
const originalLegacyEnvHost = process.env.KANBAN_RUNTIME_HOST;
const originalEnvHttps = process.env.NKLEIN_RUNTIME_HTTPS;
const originalLegacyEnvHttps = process.env.KANBAN_RUNTIME_HTTPS;
const originalEnvTlsCa = process.env.NKLEIN_RUNTIME_TLS_CA;
const originalLegacyEnvTlsCa = process.env.KANBAN_RUNTIME_TLS_CA;

afterEach(() => {
	setKanbanRuntimePort(originalRuntimePort);
	setKanbanRuntimeHost(originalRuntimeHost);
	setKanbanRuntimePublicHost(originalEnvPublicHost ?? null);
	clearKanbanRuntimeTls();
	resetLegacyEnvWarningsForTests();
	if (originalEnvPort === undefined) {
		delete process.env.NKLEIN_RUNTIME_PORT;
	} else {
		process.env.NKLEIN_RUNTIME_PORT = originalEnvPort;
	}
	if (originalLegacyEnvPort === undefined) {
		delete process.env.KANBAN_RUNTIME_PORT;
	} else {
		process.env.KANBAN_RUNTIME_PORT = originalLegacyEnvPort;
	}
	if (originalEnvHost === undefined) {
		delete process.env.NKLEIN_RUNTIME_HOST;
	} else {
		process.env.NKLEIN_RUNTIME_HOST = originalEnvHost;
	}
	if (originalEnvPublicHost === undefined) {
		delete process.env.NKLEIN_RUNTIME_PUBLIC_HOST;
	} else {
		process.env.NKLEIN_RUNTIME_PUBLIC_HOST = originalEnvPublicHost;
	}
	if (originalLegacyEnvHost === undefined) {
		delete process.env.KANBAN_RUNTIME_HOST;
	} else {
		process.env.KANBAN_RUNTIME_HOST = originalLegacyEnvHost;
	}
	if (originalEnvHttps === undefined) {
		delete process.env.NKLEIN_RUNTIME_HTTPS;
	} else {
		process.env.NKLEIN_RUNTIME_HTTPS = originalEnvHttps;
	}
	if (originalLegacyEnvHttps === undefined) {
		delete process.env.KANBAN_RUNTIME_HTTPS;
	} else {
		process.env.KANBAN_RUNTIME_HTTPS = originalLegacyEnvHttps;
	}
	if (originalEnvTlsCa === undefined) {
		delete process.env.NKLEIN_RUNTIME_TLS_CA;
	} else {
		process.env.NKLEIN_RUNTIME_TLS_CA = originalEnvTlsCa;
	}
	if (originalLegacyEnvTlsCa === undefined) {
		delete process.env.KANBAN_RUNTIME_TLS_CA;
	} else {
		process.env.KANBAN_RUNTIME_TLS_CA = originalLegacyEnvTlsCa;
	}
});

describe("runtime-endpoint", () => {
	it("parses default port when env value is missing", () => {
		expect(parseRuntimePort(undefined)).toBe(DEFAULT_KANBAN_RUNTIME_PORT);
	});

	it("throws for invalid ports", () => {
		expect(() => parseRuntimePort("0")).toThrow(/Invalid NKLEIN_RUNTIME_PORT value/);
		expect(() => parseRuntimePort("70000")).toThrow(/Invalid NKLEIN_RUNTIME_PORT value/);
		expect(() => parseRuntimePort("abc")).toThrow(/Invalid NKLEIN_RUNTIME_PORT value/);
	});

	it("updates runtime url builders when port changes", () => {
		setKanbanRuntimePort(4567);
		expect(getKanbanRuntimePort()).toBe(4567);
		expect(process.env.NKLEIN_RUNTIME_PORT).toBe("4567");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("http://127.0.0.1:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("ws://127.0.0.1:4567/api/terminal/ws");
	});

	it("updates runtime url builders when host changes", () => {
		setKanbanRuntimeHost("100.64.0.1");
		setKanbanRuntimePort(4567);
		expect(getKanbanRuntimeHost()).toBe("100.64.0.1");
		expect(process.env.NKLEIN_RUNTIME_HOST).toBe("100.64.0.1");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("http://100.64.0.1:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("ws://100.64.0.1:4567/api/terminal/ws");
	});

	it("uses an advertised public host for browser-facing origins without changing the bind host", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePublicHost("http://192.168.1.25:3484/project");
		setKanbanRuntimePort(4567);
		expect(getKanbanRuntimeHost()).toBe("0.0.0.0");
		expect(getKanbanRuntimePublicHost()).toBe("192.168.1.25");
		expect(getKanbanRuntimeAdvertisedHost()).toBe("192.168.1.25");
		expect(process.env.NKLEIN_RUNTIME_PUBLIC_HOST).toBe("192.168.1.25");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("http://192.168.1.25:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("ws://192.168.1.25:4567/api/terminal/ws");
	});

	it("normalizes optional public hosts and clears the env when removed", () => {
		expect(normalizeRuntimePublicHost(" https://klein.lan:9443/path ")).toBe("klein.lan");
		setKanbanRuntimePublicHost("klein.lan");
		expect(getKanbanRuntimeAdvertisedHost()).toBe("klein.lan");
		setKanbanRuntimePublicHost(null);
		expect(getKanbanRuntimePublicHost()).toBeNull();
		expect(process.env.NKLEIN_RUNTIME_PUBLIC_HOST).toBeUndefined();
	});

	it("defaults host to 127.0.0.1", () => {
		expect(getKanbanRuntimeHost()).toBe("127.0.0.1");
	});

	it("switches runtime url builders to https and wss when tls is enabled", () => {
		setKanbanRuntimeHost("localhost");
		setKanbanRuntimePort(4567);
		setKanbanRuntimeTls({
			cert: "test-cert",
			key: "test-key",
			ca: "test-cert",
		});
		expect(isKanbanRuntimeHttps()).toBe(true);
		expect(process.env.NKLEIN_RUNTIME_HTTPS).toBe("1");
		expect(process.env.NKLEIN_RUNTIME_TLS_CA).toBe("test-cert");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("https://localhost:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("wss://localhost:4567/api/terminal/ws");
	});

	it("creates a pinned runtime fetch only when a tls ca is configured", async () => {
		expect(await getRuntimeFetch()).toBe(globalThis.fetch);
		setKanbanRuntimeTls({
			cert: "test-cert",
			key: "test-key",
			ca: "test-cert",
		});
		expect(await getRuntimeFetch()).not.toBe(globalThis.fetch);
	});
});
