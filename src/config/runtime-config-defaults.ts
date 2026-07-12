import type {
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeLlmfitCatalogUpdateMode,
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
/**
 * §5.L capability-broker taint gate at the chat model↔tool seam — DEFAULT-ON (David decision-5, 2026-07-04): the
 * fail-closed prompt-injection defense ships on. Once untrusted web content enters a chat turn, a subsequent
 * protected-sink action (host write/command) is refused unless a trusted plan backs it. Set `capabilityBrokerEnabled`
 * false to disable. (Structurally inert on the Docker-isolated swarm, which has no protected sinks — see
 * swarm-tool-capability.ts.)
 */
export const DEFAULT_CAPABILITY_BROKER_ENABLED = true;
export const DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED = true;
/**
 * §5.L egress proxy (docs/dev/egress-proxy-design.md §6 I3) — the persisted equivalent of the
 * `NKLEIN_SANDBOX_EGRESS_PROXY` env flag. OFF BY DEFAULT: flag off ⇒ byte-identical to the pre-proxy world
 * (the `allowlist` tier stays `--network none`, fail-closed R2). The env var still overrides (real environment wins).
 */
export const DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED = false;
/** §5.AR basic-memory MCP (write-capable authored memory) — OFF BY DEFAULT; `NKLEIN_BASIC_MEMORY` still force-enables (§5.BB). */
export const DEFAULT_BASIC_MEMORY_ENABLED = false;
/**
 * §5.AA chat adaptive truncation ladder — ON BY DEFAULT (decision-1 default-ON flip); the config bit mirrors that, and
 * `NKLEIN_CHAT_ADAPTIVE_TRUNCATION` stays a two-way env escape hatch (`0` force-disables, truthy force-enables — §5.BB).
 */
export const DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED = true;
/** §5.AN reasoning output-budget sizing on chat turns — OFF BY DEFAULT; `NKLEIN_REASONING_BUDGET` still force-enables (§5.BB). */
export const DEFAULT_REASONING_BUDGET_ENABLED = false;
/** §5.AW review-panel lenses (still gated on second-opinion review) — OFF BY DEFAULT; `NKLEIN_REVIEW_LENSES` still force-enables (§5.BB). */
export const DEFAULT_REVIEW_LENSES_ENABLED = false;
export const DEFAULT_AGENT_TIMEOUT_MODE: RuntimeAgentTimeoutMode = "normal";
export const DEFAULT_AGENT_TIMEOUT_PROFILE: RuntimeAgentTimeoutProfile = "local";
export const DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED = true;
export const DEFAULT_LOST_HEARTBEAT_POLICY: RuntimeLostHeartbeatPolicy = "park";
/** §5.AB llmfit catalog updates default to explicit checks + suggestions, never background pulls. */
export const DEFAULT_LLMFIT_CATALOG_UPDATE_MODE: RuntimeLlmfitCatalogUpdateMode = "notify";
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
