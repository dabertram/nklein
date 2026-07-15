/**
 * Preflight: are the models a run's configured roles need actually LOADED on the fleet? A live dev-test (2026-07-15)
 * stranded a review card because the configured reviewer/worker model was not loaded — child cards route by role, so a
 * role whose model is absent has nothing to dispatch to and its cards sit forever. This pure check compares the
 * configured role → modelId requirements against the loaded-model identifiers/keys so a preflight can warn (or an
 * autoloader can act) BEFORE seeding work. An unset role (null modelId) inherits the default model and is not a
 * requirement here. PURE.
 */

/** A loaded model as reported by `lms ps`: the invoke `identifier` and the publisher `modelKey` (either can match). */
export interface LoadedModelRef {
	identifier: string;
	modelKey: string;
}

/** One role's model requirement (e.g. `{ role: "reviewer", modelId: "qwen/qwen2.5-coder-14b" }`). */
export interface RoleModelRequirement {
	role: string;
	modelId: string | null;
}

export interface RoleModelReadinessResult {
	/** True when every role with a configured model has that model loaded. */
	ready: boolean;
	/** Roles whose configured model is NOT loaded — these would strand cards. */
	missing: { role: string; modelId: string }[];
	/** Roles whose configured model IS loaded. */
	satisfied: { role: string; modelId: string }[];
}

function normalizeModelRef(value: string): string {
	return value.trim().toLowerCase();
}

export function checkRoleModelReadiness(input: {
	requirements: readonly RoleModelRequirement[];
	loaded: readonly LoadedModelRef[];
}): RoleModelReadinessResult {
	const loadedKeys = new Set<string>();
	for (const model of input.loaded) {
		if (model.identifier) {
			loadedKeys.add(normalizeModelRef(model.identifier));
		}
		if (model.modelKey) {
			loadedKeys.add(normalizeModelRef(model.modelKey));
		}
	}
	const missing: { role: string; modelId: string }[] = [];
	const satisfied: { role: string; modelId: string }[] = [];
	for (const requirement of input.requirements) {
		const modelId = requirement.modelId?.trim();
		if (!modelId) {
			// Unset role → inherits the default model; not a per-role requirement.
			continue;
		}
		if (loadedKeys.has(normalizeModelRef(modelId))) {
			satisfied.push({ role: requirement.role, modelId });
		} else {
			missing.push({ role: requirement.role, modelId });
		}
	}
	return { ready: missing.length === 0, missing, satisfied };
}
