import {
	areRuntimeSwarmGuardrailsEqual,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS,
	type RuntimeModelRoles,
	type RuntimeSwarmGuardrails,
} from "./runtime-config-api-contract";

function modelIdentityKey(input: { providerId?: string | null; modelId?: string | null }): string | null {
	const providerId = input.providerId?.trim() ?? "";
	const modelId = input.modelId?.trim() ?? "";
	if (!providerId && !modelId) {
		return null;
	}
	return `${providerId}\0${modelId}`;
}

export function countConfiguredSwarmRoleModels(modelRoles: RuntimeModelRoles | null | undefined): number {
	const distinct = new Set<string>();
	for (const settings of Object.values(modelRoles ?? {})) {
		const primary = modelIdentityKey(settings);
		if (primary) {
			distinct.add(primary);
		}
		for (const additional of settings.additionalModels ?? []) {
			const key = modelIdentityKey(additional);
			if (key) {
				distinct.add(key);
			}
		}
	}
	return distinct.size;
}

export function shouldUseParallelSwarmGuardrails(input: {
	configuredGuardrails: RuntimeSwarmGuardrails;
	effectiveModelRoles: RuntimeModelRoles | null | undefined;
}): boolean {
	return (
		countConfiguredSwarmRoleModels(input.effectiveModelRoles) >= 2 &&
		areRuntimeSwarmGuardrailsEqual(input.configuredGuardrails, DEFAULT_RUNTIME_SWARM_GUARDRAILS)
	);
}

export function resolveRuntimeSwarmGuardrailsForModelRoles(input: {
	configuredGuardrails: RuntimeSwarmGuardrails;
	effectiveModelRoles: RuntimeModelRoles | null | undefined;
}): RuntimeSwarmGuardrails {
	return shouldUseParallelSwarmGuardrails(input)
		? PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS
		: input.configuredGuardrails;
}
