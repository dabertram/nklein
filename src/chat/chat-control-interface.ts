/**
 * F2.30 — chat-as-full-control-plane (David directive 2026-09-02): a typed CONTROL-ACTION REGISTRY behind ONE
 * `nklein_control` chat tool. The tool's generated description enumerates the whole interface — the "prompt that
 * knows a full interface" — so the chat model can drive !Klein (start/stop/pause cards, move lanes, config) from
 * a plain user message. The registry is the single source of truth: the chat tool definition is generated from
 * it, and the planned `nklein-mcp` exposure serves the SAME registry (increment c).
 *
 * `control_plane` invariant (matches chat-board-tools): every action touches only !Klein-owned state through
 * injected executors — never the working tree or a shell. Results name card ids/titles/lanes only, never on-disk
 * paths. Deps are injected so the registry is unit-testable without disk or a live runtime.
 */
import type { RuntimeBoardData } from "../core/api-contract";
import type { OperatorColumnId } from "../core/operator-task-state";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatTool } from "./chat-tool-executor";

/** The lanes chat may move a card into. `trash` is the recoverable board lane, never a disk deletion. */
const MOVABLE_COLUMNS: readonly OperatorColumnId[] = [
	"backlog",
	"planning",
	"ready",
	"in_progress",
	"review",
	"completed",
	"trash",
];

export interface NKleinControlSessionSummary {
	taskId: string;
	state: string;
	modelId: string | null;
}

/** Executors over the runtime — injected from the runtime API (production) or fakes (tests). */
export interface NKleinControlDeps {
	loadBoard: () => Promise<RuntimeBoardData>;
	/** Move a card to a lane; resolves the card's title for the result line. Null ⇒ card not found. */
	moveCard: (taskId: string, column: OperatorColumnId) => Promise<{ title: string } | null>;
	/** Start a card's agent session through the FULL start path (guards, model selection, queueing). */
	startCard: (taskId: string, options: { planMode?: boolean }) => Promise<{ ok: boolean; error?: string | null }>;
	stopCard: (taskId: string) => Promise<boolean>;
	pauseCard: (taskId: string) => Promise<boolean>;
	resumeCard: (taskId: string) => Promise<boolean>;
	listSessions: () => Promise<readonly NKleinControlSessionSummary[]>;
	setMaxConcurrentTasks: (value: number) => Promise<boolean>;
	/**
	 * Explicit re-decompose (David 2026-09-04): file a decompose card for ONE card or for EVERY unfinished card
	 * and start it through the guarded start path. Returns what was filed and what was skipped (with reasons).
	 */
	requestRedecompose: (input: { scope: "card" | "project_unfinished"; taskId?: string }) => Promise<{
		filed: readonly { taskId: string; redecomposeTaskId: string; title: string; started: boolean }[];
		skipped: readonly { taskId: string; reason: string }[];
	}>;
	/** Un-park a review-lane card (2026-09-05): clear the park and re-dispatch its review. */
	unparkReview: (taskId: string) => Promise<{
		ok: boolean;
		previousParkedReason: string | null;
		dispatched: boolean;
		error: string | null;
	}>;
}

export interface NKleinControlAction {
	name: string;
	description: string;
	/** JSON-schema `properties` for this action's params (rendered into the tool description). */
	params: Record<string, { type: string; description: string; enum?: readonly string[] }>;
	required: readonly string[];
	execute: (deps: NKleinControlDeps, params: Record<string, unknown>) => Promise<string>;
}

function requireString(params: Record<string, unknown>, key: string): string | null {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The registry — one entry per controllable operation. Extend HERE; tool + (future) MCP surfaces follow. */
export function buildNKleinControlRegistry(): readonly NKleinControlAction[] {
	return [
		{
			name: "runtime_status",
			description: "Read the live runtime state: board lanes with card counts and ids, plus active agent sessions.",
			params: {},
			required: [],
			execute: async (deps) => {
				const [board, sessions] = await Promise.all([deps.loadBoard(), deps.listSessions()]);
				const lanes = board.columns
					.map((column) => {
						const ids = column.cards.map((card) => card.id);
						return `${column.id}: ${ids.length}${ids.length > 0 ? ` [${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", …" : ""}]` : ""}`;
					})
					.join("\n");
				const live =
					sessions.length > 0
						? sessions.map((s) => `${s.taskId}: ${s.state}${s.modelId ? ` (${s.modelId})` : ""}`).join("\n")
						: "(none)";
				return `Board lanes:\n${lanes}\n\nAgent sessions:\n${live}`;
			},
		},
		{
			name: "start_card",
			description:
				"Start a card's agent session (the full start path: guards, model selection, queueing). Optional plan mode for decomposition.",
			params: {
				taskId: { type: "string", description: "The card id to start." },
				planMode: { type: "boolean", description: "Start in plan mode (architect/decomposition). Default false." },
			},
			required: ["taskId"],
			execute: async (deps, params) => {
				const taskId = requireString(params, "taskId");
				if (!taskId) {
					return "start_card requires a non-empty `taskId`.";
				}
				const result = await deps.startCard(taskId, { planMode: params.planMode === true });
				return result.ok
					? `Started card [${taskId}]${params.planMode === true ? " in plan mode" : ""}.`
					: `Could not start [${taskId}]: ${result.error ?? "the start was refused"}.`;
			},
		},
		{
			name: "stop_card",
			description:
				"Stop a card's running agent session (the card stays in its lane; work already captured is kept).",
			params: { taskId: { type: "string", description: "The card id to stop." } },
			required: ["taskId"],
			execute: async (deps, params) => {
				const taskId = requireString(params, "taskId");
				if (!taskId) {
					return "stop_card requires a non-empty `taskId`.";
				}
				return (await deps.stopCard(taskId))
					? `Stopped the session for [${taskId}].`
					: `No stoppable session for [${taskId}].`;
			},
		},
		{
			name: "pause_card",
			description:
				"Pause a card: its session is held and the autonomous machinery will not restart it until resumed.",
			params: { taskId: { type: "string", description: "The card id to pause." } },
			required: ["taskId"],
			execute: async (deps, params) => {
				const taskId = requireString(params, "taskId");
				if (!taskId) {
					return "pause_card requires a non-empty `taskId`.";
				}
				return (await deps.pauseCard(taskId)) ? `Paused [${taskId}].` : `Could not pause [${taskId}].`;
			},
		},
		{
			name: "resume_card",
			description: "Resume a paused card so the autonomous machinery may run it again.",
			params: { taskId: { type: "string", description: "The card id to resume." } },
			required: ["taskId"],
			execute: async (deps, params) => {
				const taskId = requireString(params, "taskId");
				if (!taskId) {
					return "resume_card requires a non-empty `taskId`.";
				}
				return (await deps.resumeCard(taskId)) ? `Resumed [${taskId}].` : `Could not resume [${taskId}].`;
			},
		},
		{
			name: "move_card",
			description:
				"Move a card to a board lane. `trash` is the recoverable board lane (never a disk deletion); `completed` marks it done.",
			params: {
				taskId: { type: "string", description: "The card id to move." },
				column: { type: "string", description: "Target lane.", enum: MOVABLE_COLUMNS },
			},
			required: ["taskId", "column"],
			execute: async (deps, params) => {
				const taskId = requireString(params, "taskId");
				const column = requireString(params, "column") as OperatorColumnId | null;
				if (!taskId || !column) {
					return "move_card requires `taskId` and `column`.";
				}
				if (!MOVABLE_COLUMNS.includes(column)) {
					return `Unknown column "${column}". Valid: ${MOVABLE_COLUMNS.join(", ")}.`;
				}
				const moved = await deps.moveCard(taskId, column);
				return moved ? `Moved [${taskId}] "${moved.title}" to ${column}.` : `Card [${taskId}] was not found.`;
			},
		},
		{
			name: "set_max_concurrent_tasks",
			description: "Set how many cards may run agent sessions at once (the board concurrency cap).",
			params: { value: { type: "number", description: "The new cap (1-16)." } },
			required: ["value"],
			execute: async (deps, params) => {
				const value = typeof params.value === "number" ? Math.trunc(params.value) : Number.NaN;
				if (!Number.isFinite(value) || value < 1 || value > 16) {
					return "set_max_concurrent_tasks requires an integer `value` between 1 and 16.";
				}
				return (await deps.setMaxConcurrentTasks(value))
					? `Max concurrent tasks set to ${value}.`
					: "Could not update the concurrency cap.";
			},
		},
		{
			name: "redecompose",
			description:
				"Split work into smaller cards: file a decompose card (full board context) for ONE card, or for EVERY unfinished card on the board, and start it. Use when cards are too big for the available models.",
			params: {
				scope: {
					type: "string",
					description: "`card` = one card (needs taskId); `project_unfinished` = every unfinished card.",
					enum: ["card", "project_unfinished"] as const,
				},
				taskId: { type: "string", description: "The card id to split (scope=card)." },
			},
			required: ["scope"],
			execute: async (deps, params) => {
				const scope = requireString(params, "scope");
				if (scope !== "card" && scope !== "project_unfinished") {
					return "redecompose requires `scope` = card | project_unfinished.";
				}
				const taskId = requireString(params, "taskId") ?? undefined;
				if (scope === "card" && !taskId) {
					return "redecompose with scope=card requires a non-empty `taskId`.";
				}
				const result = await deps.requestRedecompose({ scope, ...(taskId ? { taskId } : {}) });
				const filed = result.filed.map(
					(entry) => `${entry.taskId} → ${entry.redecomposeTaskId}${entry.started ? " (started)" : " (queued)"}`,
				);
				const skipped = result.skipped.map((entry) => `${entry.taskId}: ${entry.reason}`);
				return [
					filed.length > 0
						? `Filed ${filed.length} decompose card(s):\n${filed.join("\n")}`
						: "Filed no decompose cards.",
					skipped.length > 0 ? `Skipped ${skipped.length}:\n${skipped.join("\n")}` : "",
				]
					.filter(Boolean)
					.join("\n\n");
			},
		},
		{
			name: "unpark_review",
			description:
				"Un-park a review-lane card that was parked for a human decision (no verdict / review loop / integration gate): clears the park and re-runs the review. Use after the underlying cause (dead reviewer model, fleet change) is fixed.",
			params: { taskId: { type: "string", description: "The parked review-lane card id." } },
			required: ["taskId"],
			execute: async (deps, params) => {
				const taskId = requireString(params, "taskId");
				if (!taskId) {
					return "unpark_review requires a non-empty `taskId`.";
				}
				const result = await deps.unparkReview(taskId);
				if (!result.ok) {
					return `Could not un-park [${taskId}]: ${result.error ?? "no reason given"}.`;
				}
				return `Un-parked [${taskId}]${result.dispatched ? " and re-dispatched its review" : " — the watchdog picks up the review on its next pass"}${
					result.previousParkedReason ? ` (was parked: ${result.previousParkedReason.slice(0, 160)})` : ""
				}.`;
			},
		},
	];
}

/** Render the registry into the tool description — the model-facing "full interface" contract. */
export function renderNKleinControlDescription(registry: readonly NKleinControlAction[]): string {
	const lines = registry.map((action) => {
		const paramText = Object.entries(action.params)
			.map(([key, schema]) => {
				const requiredMark = action.required.includes(key) ? "" : "?";
				const enumText = schema.enum ? ` (${schema.enum.join("|")})` : "";
				return `${key}${requiredMark}: ${schema.type}${enumText}`;
			})
			.join(", ");
		return `- ${action.name}(${paramText}) — ${action.description}`;
	});
	return (
		"Control !Klein directly: pass `action` (one of the operations below) and `params` (its arguments as an object). " +
		"This is the FULL control interface — board, sessions, and runtime configuration.\n" +
		lines.join("\n")
	);
}

/**
 * Build the `nklein_control` chat tool set over the registry. `control_plane` action kind: offered to can-act
 * scopes only (same gate as create_card / send_to_card), audited like every chat tool call.
 */
export function createNKleinControlTools(deps: NKleinControlDeps): ChatToolSet {
	const registry = buildNKleinControlRegistry();
	const byName = new Map(registry.map((action) => [action.name, action]));
	const tools: ChatTool[] = [
		{
			name: "nklein_control",
			actionKind: "control_plane",
			run: async (args) => {
				const actionName = typeof args.action === "string" ? args.action.trim() : "";
				const action = byName.get(actionName);
				if (!action) {
					return `Unknown action "${actionName}". Valid actions: ${registry.map((entry) => entry.name).join(", ")}.`;
				}
				const params =
					args.params && typeof args.params === "object" && !Array.isArray(args.params)
						? (args.params as Record<string, unknown>)
						: {};
				try {
					return await action.execute(deps, params);
				} catch (error) {
					return `${action.name} failed: ${error instanceof Error ? error.message : String(error)}`;
				}
			},
		},
	];
	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "nklein_control",
			description: renderNKleinControlDescription(registry),
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						description: "The control operation to perform.",
						enum: registry.map((action) => action.name),
					},
					params: {
						type: "object",
						description: "The operation's arguments (see the action list in the tool description).",
					},
				},
				required: ["action"],
			},
		},
	];
	return { tools, definitions };
}
