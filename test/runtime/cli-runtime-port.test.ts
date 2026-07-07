import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { findAvailableRuntimePort, isAddressInUseError, isPortAvailable } from "../../src/cli-runtime-port";
import { getKanbanRuntimeHost } from "../../src/core/runtime-endpoint";

describe("isAddressInUseError", () => {
	it("is true only for an EADDRINUSE-coded error", () => {
		expect(isAddressInUseError(Object.assign(new Error("in use"), { code: "EADDRINUSE" }))).toBe(true);
	});

	it("is false for other error codes, non-error objects, and non-objects", () => {
		expect(isAddressInUseError(Object.assign(new Error("perm"), { code: "EACCES" }))).toBe(false);
		expect(isAddressInUseError(new Error("no code"))).toBe(false);
		expect(isAddressInUseError({ code: "EADDRINUSE" })).toBe(true); // duck-typed shape is intentionally accepted
		expect(isAddressInUseError(null)).toBe(false);
		expect(isAddressInUseError("EADDRINUSE")).toBe(false);
	});
});

describe("isPortAvailable / findAvailableRuntimePort", () => {
	let occupier: Server | null = null;

	afterEach(async () => {
		if (occupier) {
			await new Promise<void>((resolve) => occupier?.close(() => resolve()));
			occupier = null;
		}
	});

	// Occupy an ephemeral port on the SAME host isPortAvailable probes, so the conflict is real and deterministic.
	async function occupyEphemeralPort(): Promise<number> {
		return await new Promise<number>((resolve, reject) => {
			const server = createServer();
			server.once("error", reject);
			server.listen(0, getKanbanRuntimeHost(), () => {
				occupier = server;
				const address = server.address();
				if (address && typeof address === "object") {
					resolve(address.port);
				} else {
					reject(new Error("no ephemeral port assigned"));
				}
			});
		});
	}

	it("reports an occupied port as unavailable and a free port as available", async () => {
		const port = await occupyEphemeralPort();
		expect(await isPortAvailable(port)).toBe(false);
		// After releasing it, the same port becomes available again.
		await new Promise<void>((resolve) => occupier?.close(() => resolve()));
		occupier = null;
		expect(await isPortAvailable(port)).toBe(true);
	});

	it("scans upward past an occupied start port to the next free one", async () => {
		const occupied = await occupyEphemeralPort();
		const found = await findAvailableRuntimePort(occupied);
		expect(found).toBeGreaterThan(occupied);
		expect(await isPortAvailable(found)).toBe(true);
	});
});
