/**
 * Single source of truth for UI element tooltip copy (todo §5.L / chat #5).
 *
 * Every meaningful control should be discoverable on hover/focus: a short **name** plus a one-line
 * **description** of what it does. Keeping the copy in one typed registry — instead of scattering `title=`
 * attributes or inline tooltip strings across components — keeps it reviewable, consistent, and translatable,
 * and lets `ElementTooltip` look it up by a stable id with compile-time guarantees that the id exists.
 *
 * Add an entry here, then wrap the control with `<ElementTooltip id="..."><trigger/></ElementTooltip>`.
 */
export interface ElementTooltipCopy {
	/** Short human name of the element. */
	name: string;
	/** One concise sentence: what the element is / does. */
	description: string;
}

export const ELEMENT_TOOLTIPS = {
	"top-bar.settings": {
		name: "Settings",
		description: "Open settings: models, agent roles, sandbox isolation, shortcuts, and runtime options.",
	},
	"chat.delete-session": {
		name: "Delete chat",
		description: "Delete this chat session and its transcript.",
	},
	"top-bar.debug": {
		name: "Debug",
		description: "Open the debug dialog to inspect runtime state, logs, and diagnostics.",
	},
	"top-bar.back-to-board": {
		name: "Back to board",
		description: "Return to the kanban board from the current task view.",
	},
	"top-bar.toggle-sidebar": {
		name: "Toggle sidebar",
		description: "Show or hide the project navigation sidebar.",
	},
	"board-column.start-all": {
		name: "Start all backlog tasks",
		description: "Launch every task in this column at once (subject to the swarm concurrency limit).",
	},
	"board-column.clear-trash": {
		name: "Clear trash",
		description: "Permanently delete every task in Trash. This cannot be undone.",
	},
	"board-card.resume": {
		name: "Resume task",
		description: "Continue this paused task from where its agent left off.",
	},
	"board-card.pause": {
		name: "Pause task",
		description: "Stop the agent at the next safe point; you can resume later.",
	},
	"board-card.start": {
		name: "Start task",
		description: "Launch an agent on this task (decomposes first if it's a planning card).",
	},
	"board-card.replay": {
		name: "Replay task",
		description: "Re-run this finished task from scratch on a fresh attempt.",
	},
	"card-artifact.reject": {
		name: "Reject artifact",
		description: "Discard this pending decomposition artifact without applying it to the board.",
	},
	"card-diff.collapse-expanded": {
		name: "Collapse diff",
		description: "Exit the expanded full-screen diff and return to the card view.",
	},
	"card-diff.toggle-split": {
		name: "Expand / collapse diff",
		description: "Switch between the inline diff and the full-screen split diff view.",
	},
	"board.concurrency-cap": {
		name: "Concurrent cards (parallel agents)",
		description:
			"How many cards the swarm runs at once. Each running card drives one agent, so this is also the number of agents working in parallel. Drag to change the cap.",
	},
	"board.swarm-pause": {
		name: "Pause / resume the swarm",
		description: "Stop every agent at the next safe checkpoint, or resume paused work.",
	},
	"board.dependency-edges": {
		name: "Show dependency edges",
		description:
			"Draw every card-dependency edge on the board (de-emphasized). Off by default so the board stays clean; linking a new dependency always shows its line.",
	},
	"board.code-intel": {
		name: "Code intelligence",
		description: "The project's code-index status and the embedding provider used for retrieval.",
	},
	"git.discard-changes": {
		name: "Discard all changes",
		description: "Permanently revert every uncommitted change in the working copy. This cannot be undone.",
	},
	"terminal.close": {
		name: "Close terminal",
		description: "Close this task's terminal pane.",
	},
	"project.actions": {
		name: "Project actions",
		description: "Open per-project actions: edit project settings or remove the project.",
	},
	"project.settings-gear": {
		name: "Project settings",
		description: "Open this project's settings (agents, isolation, overrides).",
	},
	"project.collapse-sidebar": {
		name: "Collapse sidebar",
		description: "Hide the project navigation sidebar to give the board more room.",
	},
	"chat.session-scope": {
		name: "Chat scope",
		description:
			"chat-only: read-only browsing, no host access. The other three all run commands on your HOST machine (filesystem + shell — not Docker-sandboxed), gated by the session's risk acknowledgement: current (host) = this project, all (host) = every loaded project, ⚠️ host = anywhere on the host (most powerful).",
	},
} as const satisfies Record<string, ElementTooltipCopy>;

export type ElementTooltipId = keyof typeof ELEMENT_TOOLTIPS;
