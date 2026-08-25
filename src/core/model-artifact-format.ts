/**
 * Model artefact FORMAT knowledge — the pure "what is a safe weights format" predicate, split out of the fenced
 * acquisition client (P25.3 phase-3 web view, 2026-08-25). The format type and the safe-format check are NOT the
 * download capability — anything may reason about formats — so they live in a non-fenced module both the fenced
 * `lmstudio-model-acquisition` client and the runtime-reachable acquisition PREVIEW import, keeping the download
 * capability (the REST client) out of the runtime's import closure while sharing this pure knowledge.
 */

export type ModelArtifactFormat = "safetensors" | "gguf" | "mlx" | "pickle" | "unknown";

/** The formats whose LOAD executes no logic — the only ones auto-download may fetch. */
export function isAutoDownloadSafeFormat(format: ModelArtifactFormat): boolean {
	return format === "safetensors" || format === "gguf" || format === "mlx";
}
