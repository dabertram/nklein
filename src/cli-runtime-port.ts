import { createServer as createNetServer } from "node:net";
import { getKanbanRuntimeHost } from "./core/runtime-endpoint";

/**
 * Runtime port resolution (todo §5.U — extracted from cli.ts as a cohesive utility). Probes whether a TCP port is
 * free on the configured runtime host, scans upward for the first available one, and classifies EADDRINUSE. Pure port
 * mechanics (coupling = node:net + the configured host), so it lifts out of the CLI wiring cleanly and is unit-testable.
 */

/** Resolve true iff `port` can be bound on the configured runtime host right now (probe binds then immediately closes). */
export async function isPortAvailable(port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const probe = createNetServer();
		probe.once("error", () => {
			resolve(false);
		});
		probe.listen(port, getKanbanRuntimeHost(), () => {
			probe.close(() => {
				resolve(true);
			});
		});
	});
}

/** Scan upward from `startPort` for the first bindable port; throws if none is free through 65535. */
export async function findAvailableRuntimePort(startPort: number): Promise<number> {
	for (let candidate = startPort; candidate <= 65535; candidate += 1) {
		if (await isPortAvailable(candidate)) {
			return candidate;
		}
	}
	throw new Error("No available runtime port found.");
}

/** Narrow an unknown error to the Node EADDRINUSE "port already bound" case. */
export function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EADDRINUSE"
	);
}
