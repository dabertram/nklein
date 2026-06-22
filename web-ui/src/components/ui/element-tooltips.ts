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
} as const satisfies Record<string, ElementTooltipCopy>;

export type ElementTooltipId = keyof typeof ELEMENT_TOOLTIPS;
