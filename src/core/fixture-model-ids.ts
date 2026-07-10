// Fixture/test model ids that must never surface as REAL models in the live registry API or the board fleet strip
// (todo 10979: `huge-advertised-model` / `local-model` / `small-local-model` leaked in as "unknown ×3" rows). Tests
// and dev-test flows exercise the registry with these synthetic ids; a persisted dev store can therefore carry them,
// and `runtime.getNKleinModelRegistry` would render them alongside genuine models. This is the ONE authoritative
// list, matched conservatively so a real model is never hidden.

/** Exact fixture/test model ids used across the suite + dev-test harnesses. Extend here, not with new heuristics. */
export const FIXTURE_MODEL_IDS: ReadonlySet<string> = new Set([
	"huge-advertised-model",
	"local-model",
	"small-local-model",
	"tiny-local-model",
	"test-model",
	"mock-model",
	"dummy-model",
	"fixture-model",
]);

/**
 * Whether `modelId` is a synthetic fixture/test id that must be kept out of the live registry surfaces. Matches the
 * curated {@link FIXTURE_MODEL_IDS} set exactly, plus the unambiguous `*-fixture` / `mock-*` / `dummy-*` test markers
 * (case-insensitive). Deliberately narrow: a real published model id (e.g. `qwen/qwen2.5-coder-14b`) never matches.
 */
export function isFixtureModelId(modelId: string | null | undefined): boolean {
	if (!modelId) {
		return false;
	}
	const normalized = modelId.trim().toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	if (FIXTURE_MODEL_IDS.has(normalized)) {
		return true;
	}
	return /(?:^|[/:])(?:mock|dummy|fixture)-[\w.-]+$/.test(normalized) || /-fixture$/.test(normalized);
}
