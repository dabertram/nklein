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
	/** "running" when a non-spec session is driving it; "idle" otherwise. */
	state: "running" | "idle";
	/** Rounded decode tok/s EWMA when the model has speed samples, else null. */
	tokensPerSecond: number | null;
	/** §5.AQ warmth: the shell kind this model last assembled ("worker"/"review"/…), when fresh; null otherwise. */
	warmKind: string | null;
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

function isSpecTaskId(taskId: string): boolean {
	return taskId.endsWith(SPEC_SUFFIX);
}

/**
 * Derive the short label for the machine-grouping header from an endpoint reference. A bare URL is condensed to
 * `host:port` (or just `host`); a shared-endpoint id / non-URL string is shown trimmed; blank falls back to "local".
 * TODO(§5.AX): map this to a real machine name via the LM-Link map once that is client-visible.
 */
export function toEndpointLabel(endpointRef: string | null | undefined): string {
	const trimmed = (endpointRef ?? "").trim();
	if (trimmed.length === 0) {
		return "local";
	}
	try {
		const parsed = new URL(trimmed);
		return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
	} catch {
		return trimmed;
	}
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
		const row: FleetRow = {
			modelId: entry.modelId,
			servedId: entry.key,
			lineage: resolveFleetLineage(entry.modelId),
			role: driver ? roleOf(driver) : null,
			drivingTaskId,
			drivingCardTitle: drivingTaskId ? (cardTitleByTaskId.get(drivingTaskId) ?? null) : null,
			isSpec: spec !== null,
			state: driver ? "running" : "idle",
			tokensPerSecond: tokensPerSecondFor(entry),
			warmKind,
		};
		// Machine name (LM-Link feed) beats the endpoint label — real multi-machine grouping.
		const machineName = input.machineByModelId?.[entry.key] ?? input.machineByModelId?.[entry.modelId];
		const label = machineName?.trim() || toEndpointLabel(endpointRefForModel(entry));
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
