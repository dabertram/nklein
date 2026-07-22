/** Pure fact projections shared by the browser setup API and the offline CLI renderer (F5.3). */

import type { RuntimeModelRoles } from "./api-contract.js";
import { resolveDeviceRamBytes } from "./device-load-routing.js";

export function setupDeviceRamGbByMachine(input: {
	configuredDeviceRamGb: string | null;
	env?: NodeJS.ProcessEnv;
}): Record<string, number> {
	return Object.fromEntries(
		Object.entries(
			resolveDeviceRamBytes({
				configuredDeviceRamGb: input.configuredDeviceRamGb,
				...(input.env ? { env: input.env } : {}),
			}),
		).map(([machine, bytes]) => [machine, Number((bytes / 1024 ** 3).toFixed(2))]),
	);
}

export function setupModelRoleCounts(modelRoles: RuntimeModelRoles | null | undefined): {
	assigned: number;
	total: number;
} {
	const entries = Object.values(modelRoles ?? {});
	return {
		assigned: entries.filter((role) => typeof role?.modelId === "string" && role.modelId.trim().length > 0).length,
		// Architect/worker/reviewer are real setup seats even before a first-run config has role entries.
		total: Math.max(3, entries.length),
	};
}
