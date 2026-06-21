import { describe, expect, it } from "vitest";
import { resolveKleinCorePyConfig } from "../../../src/config/klein-core-config";

describe("resolveKleinCorePyConfig", () => {
	it("defaults to disabled with the local sidecar URL", () => {
		expect(resolveKleinCorePyConfig({})).toEqual({ enabled: false, sidecarUrl: "http://127.0.0.1:3585" });
	});

	it("enables on truthy NKLEIN_CORE_PY values", () => {
		for (const value of ["1", "true", "yes", "on", "TRUE"]) {
			expect(resolveKleinCorePyConfig({ NKLEIN_CORE_PY: value }).enabled).toBe(true);
		}
		expect(resolveKleinCorePyConfig({ NKLEIN_CORE_PY: "0" }).enabled).toBe(false);
	});

	it("honors a custom sidecar URL", () => {
		expect(resolveKleinCorePyConfig({ NKLEIN_CORE_PY_URL: "http://127.0.0.1:9000" }).sidecarUrl).toBe(
			"http://127.0.0.1:9000",
		);
	});
});
