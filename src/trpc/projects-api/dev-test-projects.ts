import type { RuntimeDevTestProjectRegistryResponse } from "../../core/api-contract";
import { loadDevTestProjectRegistry } from "../../nklein-agent/dev-test-project-registry";

/**
 * List the registered dev-test project scenarios (the projects-api `listDevTestProjects` procedure
 * handler, extracted from the factory). Projects the registry entries to the wire shape, including
 * tier/tags/complexity only when present. No factory dependencies.
 */
export function handleListDevTestProjects(): RuntimeDevTestProjectRegistryResponse {
	const entries = loadDevTestProjectRegistry();
	return {
		entries: entries.map((entry) => ({
			id: entry.config.id,
			title: entry.config.title,
			...(entry.config.tier !== undefined ? { tier: entry.config.tier } : {}),
			...(entry.config.tags !== undefined ? { tags: entry.config.tags } : {}),
			...(entry.config.complexity !== undefined ? { complexity: entry.config.complexity } : {}),
		})),
	};
}
