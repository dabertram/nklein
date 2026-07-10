// §5.AX: pure composer for the board's per-model FLEET block (the expandable augmentation of the "Local swarm"
// cockpit strip). Turns the loaded-model registry + the running task-session summaries + a card-title lookup into
// machine-grouped fleet rows the presentational <FleetStrip> renders. No React, no I/O — fully unit-testable.
//
// TODO(§5.AX follow-ups): (1) real machine names — grouping is by ENDPOINT label here; mapping an endpoint URL to a
// human machine name needs the LM-Link map, which is not client-side yet. (2) a "warm" (cache-warmth) indicator —
// the cache-warmth ledger is server-side and not exposed to the client, so idle rows honestly just say "idle".

import type { RuntimeNKleinModelRegistryEntry, RuntimeTaskSessionSummary } from "@/runtime/types";

/**
 * The COARSE model lineage (training/architecture family). Mirrors `src/core/model-lineage.ts` — we can't import
 * across the web-ui/core package boundary, so the ordered matchers are duplicated here (kept in lock-step by hand).
 */
export type FleetLineage =
	| "deepseek"
	| "gpt-oss"
	| "nemotron"
	| "qwen"
	| "phi"
	| "gemma"
	| "mistral"
	| "llama"
	| "unknown";

/** Ordered (first hit wins): specific trainings before base-arch matches — mirrors core LINEAGE_MATCHERS. */
const FLEET_LINEAGE_MATCHERS: readonly { lineage: Exclude<FleetLineage, "unknown">; match: RegExp }[] = [
	{ lineage: "deepseek", match: /deepseek|r1[-_]?distill/ },
	{ lineage: "gpt-oss", match: /gpt[-_]?oss/ },
	{ lineage: "nemotron", match: /nemotron/ },
	{ lineage: "qwen", match: /qwen|qwopus|qwq|ornith/ },
	{ lineage: "phi", match: /phi[-_]?[0-9]/ },
	{ lineage: "gemma", match: /gemma/ },
	{ lineage: "mistral", match: /mistral|mixtral|magistral|devstral/ },
	{ lineage: "llama", match: /llama/ },
];

/** Resolve a model id/key to its coarse lineage (`unknown` when nothing matches — e.g. a per-machine alias). */
export function resolveFleetLineage(modelId: string): FleetLineage {
	const normalized = modelId.trim().toLowerCase();
	for (const { lineage, match } of FLEET_LINEAGE_MATCHERS) {
		if (match.test(normalized)) {
			return lineage;
		}
	}
	return "unknown";
}

export type FleetRole = "architect" | "worker" | "reviewer" | null;

export interface FleetRow {
	/** The real model key (registry `.modelId`) — the lineage/telemetry anchor. */
	modelId: string;
	/** The served id (registry `.key`) — what the user sees loaded on the endpoint. */
	servedId: string;
	lineage: FleetLineage;
	/** Resolved launch role of the driving session, or null when idle / role unstamped. */
	role: FleetRole;
	/** The task this model is currently driving (a running, non-spec session), or null when idle. */
	drivingTaskId: string | null;
	/** The driving card's title (from the board), or null when idle / unknown. */
	drivingCardTitle: string | null;
	/** True when a matching `::spec` (A/B speculative) session is attached to this model. */
	isSpec: boolean;
	/**
	 * "running": a non-spec session drives it now. "idle": LOADED in LM Studio but not working. "available": known
	 * to the registry but NOT loaded anywhere — it was wrong to call these "idle" (David 2026-07-10).
	 */
	state: "running" | "idle" | "available";
	/** Rounded decode tok/s EWMA when the model has speed samples, else null. */
	tokensPerSecond: number | null;
	/** §5.AQ warmth: the shell kind this model last assembled ("worker"/"review"/…), when fresh; null otherwise. */
	warmKind: string | null;
	/** §5.AB board-level swarm legibility: the driving session's LIVE activity snippet ("watch the swarm's hands"). */
	activityText: string | null;
	/** The tool the driving session is currently using (when the activity is a tool call), else null. */
	activityToolName: string | null;
}

export interface FleetGroup {
	/** Short endpoint label used as the machine-grouping header (host:port or a shared-endpoint id). */
	endpointLabel: string;
	rows: FleetRow[];
}

export interface ComposeFleetRowsInput {
	registryModels: readonly RuntimeNKleinModelRegistryEntry[];
	runningSessions: readonly RuntimeTaskSessionSummary[];
	cardTitleByTaskId: ReadonlyMap<string, string>;
	/** §5.AX: served id → machine name (LM-Link `lms ps` feed); preferred over endpoint labels for grouping. */
	machineByModelId?: Readonly<Record<string, string>>;
	/** §5.AQ: served id → last prompt-shell (kind + assembled-at) for the warm-idle indicator. */
	warmthByModelId?: Readonly<Record<string, { kind: string; at: number }>>;
	/** Clock for warmth freshness (injected for tests); defaults to Date.now(). */
	now?: () => number;
}

/** Warmth staleness window (mirrors the router's classifyShellWarmth 10-minute tier). */
const WARMTH_FRESH_MS = 10 * 60 * 1000;

/** A `::spec` (A/B speculative) session's taskId ends with this suffix. */
const SPEC_SUFFIX = "::spec";

/**
 * Compact a live activity snippet for the glance strip: cut at the first JSON payload (tool errors embed multi-line
 * `{"error":…}` bodies that read as soup in a one-line surface — live-observed 2026-07-10) and hard-cap the length.
 * The row's tooltip keeps the full text.
 */
export function compactFleetActivityText(text: string): string {
	const withoutPayload = text.split("{", 1)[0] ?? text;
	const compact = withoutPayload
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[:,·]$/, "")
		.trim();
	if (compact.length === 0) {
		return text.replace(/\s+/g, " ").trim().slice(0, 80);
	}
	return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
}

function isSpecTaskId(taskId: string): boolean {
	return taskId.endsWith(SPEC_SUFFIX);
}

/**
 * Loopback/self aliases that all mean THIS machine. Grouping is by MACHINE, so `localhost:1234`,
 * `127.0.0.1:1234`, and an LM-Link device name of "Local" must land in ONE group — live-observed
 * (2026-07-09): the same Mac rendered as three separate fleet groups ("127.0.0.1:1234", "LOCAL",
 * "LOCALHOST:1234") purely from label spelling.
 */
const LOCAL_MACHINE_LABEL = "local";
const LOOPBACK_LABEL_PATTERN = /^(local|localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)(:\d+)?$/i;

/** Canonicalize a machine/endpoint label: any loopback/self alias (with or without port) → "local". */
export function normalizeFleetGroupLabel(label: string): string {
	const trimmed = label.trim();
	return LOOPBACK_LABEL_PATTERN.test(trimmed) ? LOCAL_MACHINE_LABEL : trimmed;
}

/**
 * Derive the short label for the machine-grouping header from an endpoint reference. Shared-endpoint ids append
 * `#<model>` to the endpoint they serialize (e.g. `http://localhost:1234/v1#qwen/qwen3-8b`,
 * `lmstudio:default#qwopus3.5-9b`), so the fragment is stripped first. A URL base condenses to `host:port`;
 * `<provider>:default` means the provider's default endpoint on THIS machine; a non-URL id passes through trimmed;
 * blank falls back to "local". Loopback hosts normalize to the canonical "local" group (machine grouping, not
 * endpoint spelling — live-found 2026-07-09: `lmstudio:default#…` ids produced a HEADERLESS group via an empty
 * URL hostname, alongside separate "localhost:1234"/"127.0.0.1:1234" groups for the same Mac).
 * TODO(§5.AX): map this to a real machine name via the LM-Link map once that is client-visible.
 */
export function toEndpointLabel(endpointRef: string | null | undefined): string {
	const trimmed = (endpointRef ?? "").trim();
	if (trimmed.length === 0) {
		return LOCAL_MACHINE_LABEL;
	}
	const base = trimmed.split("#", 1)[0] ?? trimmed;
	try {
		const parsed = new URL(base);
		if (parsed.hostname) {
			return normalizeFleetGroupLabel(parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname);
		}
	} catch {
		// Not a URL — fall through to the id-shaped handling below.
	}
	// "<provider>:default" = the provider's default endpoint, which is this machine (e.g. "lmstudio:default").
	if (/^[a-z][\w.-]*:default$/i.test(base)) {
		return LOCAL_MACHINE_LABEL;
	}
	return normalizeFleetGroupLabel(base);
}

/** The endpoint grouping key for a registry model: shared-endpoint id, else endpoint, else "local". */
function endpointRefForModel(entry: RuntimeNKleinModelRegistryEntry): string | null {
	return entry.constraints.sharedEndpointId ?? entry.endpoint ?? null;
}

function roleOf(summary: RuntimeTaskSessionSummary): FleetRole {
	const role = summary.role;
	if (role === "architect" || role === "worker" || role === "reviewer") {
		return role;
	}
	return null;
}

/** Round a nullable EWMA to a whole tok/s figure only when the model has been sampled. */
function tokensPerSecondFor(entry: RuntimeNKleinModelRegistryEntry): number | null {
	if (entry.speed.samples <= 0) {
		return null;
	}
	const ewma = entry.speed.decodeTokensPerSecondEwma;
	return ewma === null ? null : Math.round(ewma);
}

/**
 * Compose the loaded-model registry + running sessions + card titles into machine-grouped fleet rows.
 *
 * - The fleet ROWS are the LOADED models (one row per registry entry).
 * - Each row is matched to a running session by `modelId`: a running NON-spec session becomes the driver
 *   (state "running", its role/task/title populated); a matching `::spec` session sets `isSpec` (violet).
 * - Grouping is by endpoint (shared-endpoint id → endpoint → "local"), labeled via {@link toEndpointLabel}.
 * - Deterministic sort: running rows before idle, then by served model name; groups by endpoint label.
 */
export function composeFleetRows(input: ComposeFleetRowsInput): FleetGroup[] {
	const { registryModels, runningSessions, cardTitleByTaskId } = input;

	// Index running sessions by modelId, separating the driver (non-spec) from the speculative twin.
	const driverByModelId = new Map<string, RuntimeTaskSessionSummary>();
	const specByModelId = new Map<string, RuntimeTaskSessionSummary>();
	for (const summary of runningSessions) {
		if (summary.state !== "running") {
			continue;
		}
		const modelId = summary.modelId?.trim();
		if (!modelId) {
			continue;
		}
		if (isSpecTaskId(summary.taskId)) {
			// Keep the first spec session seen for the model (deterministic given a stable input order).
			if (!specByModelId.has(modelId)) {
				specByModelId.set(modelId, summary);
			}
			continue;
		}
		if (!driverByModelId.has(modelId)) {
			driverByModelId.set(modelId, summary);
		}
	}

	const groupsByLabel = new Map<string, FleetRow[]>();
	const nowMs = input.now?.() ?? Date.now();
	for (const entry of registryModels) {
		const driver = driverByModelId.get(entry.modelId) ?? null;
		const spec = specByModelId.get(entry.modelId) ?? null;
		const drivingTaskId = driver?.taskId ?? null;
		// Warmth is keyed by the SERVED id (the warmth ledger uses launch-config keys); only fresh entries show.
		const warmth = input.warmthByModelId?.[entry.key] ?? input.warmthByModelId?.[entry.modelId] ?? null;
		const warmKind = warmth && nowMs - warmth.at <= WARMTH_FRESH_MS ? warmth.kind : null;
		// LOADED = present in the lms-ps machine map. When the feed is absent/empty we cannot distinguish and keep
		// the old "idle" reading rather than wrongly demoting everything to "available".
		const loadedKeys = input.machineByModelId ? Object.keys(input.machineByModelId) : [];
		const isLoaded =
			loadedKeys.length === 0 ||
			input.machineByModelId?.[entry.key] !== undefined ||
			input.machineByModelId?.[entry.modelId] !== undefined;
		const row: FleetRow = {
			modelId: entry.modelId,
			servedId: entry.key,
			lineage: resolveFleetLineage(entry.modelId),
			role: driver ? roleOf(driver) : null,
			drivingTaskId,
			drivingCardTitle: drivingTaskId ? (cardTitleByTaskId.get(drivingTaskId) ?? null) : null,
			isSpec: spec !== null,
			state: driver ? "running" : isLoaded ? "idle" : "available",
			tokensPerSecond: tokensPerSecondFor(entry),
			warmKind,
			// The live snippet comes straight from the driver's latest hook activity — the same stream the card-level
			// Watch panel accumulates; here only the LATEST step shows (the strip is a glance surface, not a log).
			activityText: driver?.latestHookActivity?.activityText?.trim() || null,
			activityToolName: driver?.latestHookActivity?.toolName ?? null,
		};
		// Machine name (LM-Link feed) beats the endpoint label — real multi-machine grouping. Both routes
		// canonicalize loopback/self aliases so this machine is always ONE group.
		const machineName = input.machineByModelId?.[entry.key] ?? input.machineByModelId?.[entry.modelId];
		const label = machineName?.trim()
			? normalizeFleetGroupLabel(machineName)
			: toEndpointLabel(endpointRefForModel(entry));
		const bucket = groupsByLabel.get(label);
		if (bucket) {
			bucket.push(row);
		} else {
			groupsByLabel.set(label, [row]);
		}
	}

	const groups: FleetGroup[] = [...groupsByLabel.entries()].map(([endpointLabel, rows]) => ({
		endpointLabel,
		rows: rows.sort(compareRows),
	}));
	groups.sort((left, right) => left.endpointLabel.localeCompare(right.endpointLabel));
	return groups;
}

/** Running rows before idle; then by served model name (stable, locale-aware). */
function compareRows(left: FleetRow, right: FleetRow): number {
	if (left.state !== right.state) {
		return left.state === "running" ? -1 : 1;
	}
	return left.servedId.localeCompare(right.servedId);
}

/** A row worth showing even in the condensed strip: it is doing (or about to do) something. */
export function isActiveFleetRow(row: FleetRow): boolean {
	return row.state === "running" || row.isSpec || row.warmKind !== null;
}

/**
 * One-line summary for a group's hidden non-active rows, e.g. "2 idle · 16 available · qwen ×11 · deepseek ×3".
 * "idle" = loaded but not working; "available" = known but NOT loaded (they must not masquerade as idle — David
 * 2026-07-10). The strip is a glance surface — a wall of identical rows carries no information, but the lineage
 * MIX does (family diversity is a §5.AB routing signal), so the condensed line keeps exactly that.
 */
export function summarizeIdleFleetRows(rows: readonly FleetRow[]): string {
	const idleCount = rows.filter((row) => row.state === "idle").length;
	const availableCount = rows.length - idleCount;
	const counts = new Map<FleetLineage, number>();
	for (const row of rows) {
		counts.set(row.lineage, (counts.get(row.lineage) ?? 0) + 1);
	}
	const parts = [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.map(([lineage, count]) => `${lineage} ×${count}`);
	const head = [idleCount > 0 ? `${idleCount} idle` : null, availableCount > 0 ? `${availableCount} available` : null]
		.filter(Boolean)
		.join(" · ");
	return `${head} · ${parts.join(" · ")}`;
}
