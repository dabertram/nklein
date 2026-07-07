import { describe, expect, it, vi } from "vitest";
import { probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../../../src/config/klein-core-config";

describe("resolveKleinCorePyConfig", () => {
	it("defaults to ENABLED (opt-out) with the local sidecar URL", () => {
		expect(resolveKleinCorePyConfig({})).toEqual({ enabled: true, sidecarUrl: "http://127.0.0.1:3585" });
	});

	it("can be explicitly disabled with falsy NKLEIN_CORE_PY values", () => {
		for (const value of ["0", "false", "no", "off", "FALSE", ""]) {
			expect(resolveKleinCorePyConfig({ NKLEIN_CORE_PY: value }).enabled).toBe(false);
		}
	});

	it("stays enabled on truthy NKLEIN_CORE_PY values", () => {
		for (const value of ["1", "true", "yes", "on", "TRUE"]) {
			expect(resolveKleinCorePyConfig({ NKLEIN_CORE_PY: value }).enabled).toBe(true);
		}
	});

	it("honors a custom sidecar URL", () => {
		expect(resolveKleinCorePyConfig({ NKLEIN_CORE_PY_URL: "http://127.0.0.1:9000" }).sidecarUrl).toBe(
			"http://127.0.0.1:9000",
		);
	});
});

describe("probeKleinCorePyHealth", () => {
	it("reports reachable when /health responds ok", async () => {
		const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
		const result = await probeKleinCorePyHealth({
			config: { enabled: true, sidecarUrl: "http://127.0.0.1:3585" },
			fetchImpl,
		});
		expect(result).toEqual({ reachable: true, sidecarUrl: "http://127.0.0.1:3585", loadedModels: [] });
		expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:3585/health", expect.anything());
	});

	it("reports unreachable (never throws) when the sidecar is down", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		const result = await probeKleinCorePyHealth({
			config: { enabled: true, sidecarUrl: "http://127.0.0.1:3585" },
			fetchImpl,
		});
		expect(result.reachable).toBe(false);
		expect(result.loadedModels).toEqual([]);
	});

	it("parses the core's resident embedding models from the /health body (§5.H model-loaded detail)", async () => {
		const body = JSON.stringify({
			status: "ok",
			loaded_models: ["/models/nomic-embed-q4.gguf", 42, "/models/x.gguf"],
		});
		const fetchImpl = vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
		const result = await probeKleinCorePyHealth({
			config: { enabled: true, sidecarUrl: "http://127.0.0.1:3585" },
			fetchImpl,
		});
		// non-string entries are dropped defensively; reachability is the status code, not the body.
		expect(result.loadedModels).toEqual(["/models/nomic-embed-q4.gguf", "/models/x.gguf"]);
		expect(result.reachable).toBe(true);
	});

	it("keeps loadedModels empty on a non-JSON body without affecting reachability", async () => {
		const fetchImpl = vi.fn(async () => new Response("plain-text", { status: 200 })) as unknown as typeof fetch;
		const result = await probeKleinCorePyHealth({
			config: { enabled: true, sidecarUrl: "http://127.0.0.1:3585" },
			fetchImpl,
		});
		expect(result).toEqual({ reachable: true, sidecarUrl: "http://127.0.0.1:3585", loadedModels: [] });
	});
});
