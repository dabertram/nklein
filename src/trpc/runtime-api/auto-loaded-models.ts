import { createAutoLoadedModelRegistry } from "../../core/auto-loaded-model-registry";

/**
 * F1.23 — the process-wide registry of models !Klein autonomously loaded (the NKLEIN_DEVICE_RAM_GB loader), the
 * idle-TTL eviction's candidate source. Operator-loaded models never enter it (safe by construction).
 */
export const autoLoadedModels = createAutoLoadedModelRegistry();
