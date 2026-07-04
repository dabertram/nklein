import type {
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeLostHeartbeatPolicy,
} from "../core/api-contract";
import { DEFAULT_MAX_REVIEW_ROUNDS } from "../core/review-loop";

/**
 * Default runtime-config values (§5.U-extracted from the oversized `runtime-config.ts`). These are the seed values
 * `loadRuntimeConfig` and the `normalize*` helpers fall back to when a persisted field is missing or invalid. Kept in
 * their own module so the loading logic and the normalizers can both depend on them without an import cycle.
 */

export const DEFAULT_AGENT_ID: RuntimeAgentId = "nklein";
export const AUTO_SELECT_AGENT_PRIORITY: readonly RuntimeAgentId[] = [];
export const DEFAULT_DEVELOPER_MODE_ENABLED = false;
export const DEFAULT_REPLAY_CARDS_ENABLED = false;
/** §5.AC "knows today" temporal-context injection — OFF BY DEFAULT (user 2026-07-01: opt-in, zero prompt cost when off). */
export const DEFAULT_KNOWS_TODAY_ENABLED = false;
/** §5.AR curated sandbox-hosted MCP servers — ON BY DEFAULT (user 2026-07-01: available with a global/per-project opt-out). */
export const DEFAULT_SANDBOX_MCP_SERVERS_ENABLED = true;
/** §5.L capability-broker taint gate at the chat model↔tool seam — OFF BY DEFAULT (opt-in prompt-injection defense). */
export const DEFAULT_CAPABILITY_BROKER_ENABLED = false;
export const DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED = true;
export const DEFAULT_AGENT_TIMEOUT_MODE: RuntimeAgentTimeoutMode = "normal";
export const DEFAULT_AGENT_TIMEOUT_PROFILE: RuntimeAgentTimeoutProfile = "local";
export const DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED = true;
export const DEFAULT_LOST_HEARTBEAT_POLICY: RuntimeLostHeartbeatPolicy = "park";
export const DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED = true;
export const DEFAULT_SECOND_OPINION_REVIEW_ENABLED = true;
export const DEFAULT_REVIEW_MAX_ROUNDS = DEFAULT_MAX_REVIEW_ROUNDS;
export const DEFAULT_CODE_EMBEDDING_SETTINGS: RuntimeCodeEmbeddingSettings = {
	// Zero-config default: an in-process GGUF embedder served by the Python core. It auto-downloads on first
	// use and degrades to the lexical embedding when the core is disabled/unreachable, so behavior is unchanged
	// until the core is enabled. `local_lexical` stays selectable as the explicit no-download fallback.
	provider: "local_gguf",
	model: "nomic-embed-text-v1.5",
	baseUrl: null,
};
export const DEFAULT_MAX_CONCURRENT_TASKS = 3;
export const DEFAULT_LOCAL_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_LOCAL_STREAM_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LOCAL_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LOCAL_AGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LOCAL_CONVERSATION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
