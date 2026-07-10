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

export { classifyRequest, DEFAULT_REQUEST_CLASS_MARKERS } from "./aimock/request-classifier.js";
export type { ClassifierRequestShape, RequestClassMarkers } from "./aimock/request-classifier.js";
export { compileScenarioScript, compileTrack } from "./aimock/track-compiler.js";
export { createSimulatorServer } from "./server.js";
export type { SimulatorServer, SimulatorServerOptions } from "./server.js";
export { createLmStudioShim, type SimulatedModel } from "./aimock/lmstudio-shim.js";
export { createRecordProxy } from "./reflection/record-proxy.js";
export type { RecordProxyHandle, RecordProxyOptions } from "./reflection/record-proxy.js";
export { classifyObservedFailure, distillCampaign, distillInteraction } from "./reflection/distill.js";
export type { RecordedFixtureEntry } from "./reflection/distill.js";
