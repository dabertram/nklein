export interface FleetHostObservationInput {
	seenModels: Iterable<string>;
	machineByModelId: ReadonlyMap<string, string>;
	minHosts?: number;
}

export interface FleetHostModels {
	hostId: string;
	models: readonly string[];
}

export interface FleetHostObservation {
	observed: boolean;
	minHosts: number;
	hostCount: number;
	modelsByHost: readonly FleetHostModels[];
	unresolvedModels: readonly string[];
}

function normalizeMinHosts(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return 2;
	}
	return Math.max(1, Math.trunc(value));
}

export function evaluateFleetHostObservation(input: FleetHostObservationInput): FleetHostObservation {
	const minHosts = normalizeMinHosts(input.minHosts);
	const modelsByHost = new Map<string, Set<string>>();
	const unresolvedModels = new Set<string>();

	for (const rawModel of input.seenModels) {
		const model = rawModel.trim();
		if (!model) {
			continue;
		}
		const hostId = input.machineByModelId.get(model);
		if (!hostId) {
			unresolvedModels.add(model);
			continue;
		}
		const hostModels = modelsByHost.get(hostId) ?? new Set<string>();
		hostModels.add(model);
		modelsByHost.set(hostId, hostModels);
	}

	const rows = [...modelsByHost.entries()]
		.map(([hostId, models]) => ({ hostId, models: [...models].sort() }))
		.sort((a, b) => a.hostId.localeCompare(b.hostId));
	const hostCount = rows.length;
	return {
		observed: hostCount >= minHosts,
		minHosts,
		hostCount,
		modelsByHost: rows,
		unresolvedModels: [...unresolvedModels].sort(),
	};
}
