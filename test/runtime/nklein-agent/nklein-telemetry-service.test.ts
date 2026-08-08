import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * A singleton wrapper around the SDK's telemetry service. The singleton is the whole contract: a second client
 * built alongside the first does not fail — it double-reports, which is the kind of defect that shows up as a
 * puzzling metric rather than as an error.
 *
 * The disposal ordering is the sharper half. The module clears the singleton BEFORE awaiting `dispose()`, so a
 * dispose that rejects still leaves the slot empty. Clearing afterwards would leave a half-disposed client
 * installed and handed to every later caller — a service that is neither usable nor replaceable.
 */
const sdk = vi.hoisted(() => ({
	createClineTelemetryServiceConfig: vi.fn((config: Record<string, unknown>) => config),
	createConfiguredTelemetryService: vi.fn(),
}));

vi.mock("@cline/sdk", () => sdk);

const { disposeCliTelemetryService, getCliTelemetryService } = await import(
	"../../../src/nklein-agent/nklein-telemetry-service"
);

function newService() {
	return { dispose: vi.fn(async () => undefined), capture: vi.fn() };
}

beforeEach(() => {
	vi.clearAllMocks();
	sdk.createClineTelemetryServiceConfig.mockImplementation((config) => config);
	sdk.createConfiguredTelemetryService.mockImplementation(() => ({ telemetry: newService() }));
});

afterEach(async () => {
	await disposeCliTelemetryService().catch(() => undefined);
});

describe("the singleton", () => {
	it("builds the service once and returns the same instance thereafter", async () => {
		// A second client does not error, it double-reports — a defect that surfaces as a confusing number rather
		// than as a failure.
		const first = getCliTelemetryService();
		const second = getCliTelemetryService();

		expect(second).toBe(first);
		expect(sdk.createConfiguredTelemetryService).toHaveBeenCalledTimes(1);
	});

	it("does not rebuild when a later caller supplies a logger", async () => {
		// Callers arrive in an order nobody controls; the one that happens to pass a logger must not get a second
		// client just because the first was built without one.
		const first = getCliTelemetryService();
		const second = getCliTelemetryService({ info: vi.fn() } as never);

		expect(second).toBe(first);
		expect(sdk.createConfiguredTelemetryService).toHaveBeenCalledTimes(1);
	});

	it("passes a logger through when the FIRST caller supplies one", async () => {
		const logger = { info: vi.fn() } as never;
		getCliTelemetryService(logger);

		expect(sdk.createConfiguredTelemetryService.mock.calls[0]?.[0]).toMatchObject({ logger });
	});
});

describe("the metadata it reports", () => {
	it("identifies the product and its version, without identifying the user", async () => {
		// Everything here is about the BUILD and the machine class, never about who is running it. Local-only is a
		// prime directive, and the metadata block is the easiest place for a user-scoped field to appear unnoticed.
		getCliTelemetryService();
		const metadata = (sdk.createClineTelemetryServiceConfig.mock.calls[0]?.[0]?.metadata ?? {}) as Record<
			string,
			unknown
		>;

		expect(metadata).toMatchObject({ cline_type: "kanban", platform: "kanban" });
		expect(typeof metadata.extension_version).toBe("string");
		expect(metadata.extension_version).not.toBe("");
		for (const key of Object.keys(metadata)) {
			expect(key, `metadata carries a user-scoped field: ${key}`).not.toMatch(/user|email|name|id$|machine|host/i);
		}
	});

	it("records the platform it is running on", async () => {
		getCliTelemetryService();
		const metadata = (sdk.createClineTelemetryServiceConfig.mock.calls[0]?.[0]?.metadata ?? {}) as Record<
			string,
			unknown
		>;

		expect(typeof metadata.os_type).toBe("string");
		expect(metadata.platform_version).toBe(process.version);
	});
});

describe("disposal", () => {
	it("disposes the live service", async () => {
		const service = newService();
		sdk.createConfiguredTelemetryService.mockReturnValue({ telemetry: service });
		getCliTelemetryService();
		await disposeCliTelemetryService();

		expect(service.dispose).toHaveBeenCalledTimes(1);
	});

	it("lets the NEXT caller build a fresh service", async () => {
		const first = getCliTelemetryService();
		await disposeCliTelemetryService();
		const second = getCliTelemetryService();

		expect(second).not.toBe(first);
		expect(sdk.createConfiguredTelemetryService).toHaveBeenCalledTimes(2);
	});

	it("is a silent no-op when nothing was ever built", async () => {
		// Teardown runs on paths that may never have touched telemetry at all.
		await expect(disposeCliTelemetryService()).resolves.toBeUndefined();
		expect(sdk.createConfiguredTelemetryService).not.toHaveBeenCalled();
	});

	it("does not dispose twice", async () => {
		const service = newService();
		sdk.createConfiguredTelemetryService.mockReturnValue({ telemetry: service });
		getCliTelemetryService();
		await disposeCliTelemetryService();
		await disposeCliTelemetryService();

		expect(service.dispose).toHaveBeenCalledTimes(1);
	});

	it("clears the slot even when dispose REJECTS", async () => {
		// The ordering probe. The singleton is cleared before the await, so a failing dispose cannot leave a
		// half-disposed client installed and handed to every later caller — a service neither usable nor
		// replaceable. Clearing after the await would do exactly that.
		const failing = { dispose: vi.fn(async () => Promise.reject(new Error("dispose failed"))) };
		sdk.createConfiguredTelemetryService.mockReturnValueOnce({ telemetry: failing });
		const first = getCliTelemetryService();

		await expect(disposeCliTelemetryService()).rejects.toThrow(/dispose failed/);

		const second = getCliTelemetryService();
		expect(second).not.toBe(first);
	});
});
