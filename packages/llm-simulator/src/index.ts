/**
 * @nklein/llm-simulator — LLM response simulator for agentic-tool testing.
 *
 * Composition: aimock (OpenAI-compatible transport: HTTP + SSE + fixtures + chaos + record/replay)
 * + scenario TRACKS keyed by the failure catalog (docs/dev/llm-simulator/failure-catalog.md)
 * + a seeded driver (same seed ⇒ identical run) + model-family quirk profiles
 * + an LM Studio /api/v0 shim (model list/load states/stats).
 *
 * DELIBERATELY free of !Klein imports — this package is separable as a standalone product.
 */

export { createSeededRng, type SeededRng } from "./scenario/seeded-rng.js";
export type {
	RequestClass,
	ScenarioScript,
	ScenarioTrack,
	ScenarioTurn,
	TurnBehavior,
} from "./scenario/track-types.js";
