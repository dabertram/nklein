/**
 * System-tray / menu-bar applet — the PURE menu model (§ desktop app #13.1). The Electron `Tray` + `Menu` are GUI
 * objects that can't be unit-tested, so the DECISION of what the tray shows (labels, enabled state, which command each
 * item fires, the tooltip) lives here as pure data; the thin effectful `tray.ts` maps this template onto a real Electron
 * menu + click handlers. This keeps the applet's behaviour testable and the GUI layer trivial.
 */

/** The actions a tray item can trigger; the effectful layer binds each to a handler. */
export type TrayCommand = "open" | "toggle-pause" | "quit";

/** The live state the tray reflects. */
export interface TrayState {
	/** Whether autonomous work is currently paused. */
	paused: boolean;
	/** A short human activity line, e.g. "3 cards running" / "Idle". */
	activitySummary: string;
}

/** One entry in the tray context menu. A `separator` carries no label/command. */
export interface TrayMenuItem {
	type: "normal" | "separator";
	label?: string;
	command?: TrayCommand;
	/** Clickable? Info lines (the activity readout) are disabled. Defaults to true for command items. */
	enabled?: boolean;
}

const SEPARATOR: TrayMenuItem = { type: "separator" };

/**
 * Build the tray context-menu template from the live state (pure). Shape:
 *   • activity readout (disabled info line) ─── • Open !Klein ─── • Pause/Resume work ─── • Quit
 * The Pause/Resume item's label flips with `state.paused`.
 */
export function buildTrayMenuTemplate(state: TrayState): TrayMenuItem[] {
	return [
		{ type: "normal", label: state.activitySummary, enabled: false },
		SEPARATOR,
		{ type: "normal", label: "Open !Klein", command: "open", enabled: true },
		{
			type: "normal",
			label: state.paused ? "Resume work" : "Pause work",
			command: "toggle-pause",
			enabled: true,
		},
		SEPARATOR,
		{ type: "normal", label: "Quit !Klein", command: "quit", enabled: true },
	];
}

/** Build the tray hover tooltip from the live state (pure). */
export function buildTrayTooltip(state: TrayState): string {
	const suffix = state.paused ? " (paused)" : "";
	return `!Klein — ${state.activitySummary}${suffix}`;
}

/** Summarize a running-card count into the activity line (pure). 0 ⇒ "Idle"; 1 ⇒ singular. */
export function summarizeTrayActivity(runningCards: number): string {
	if (!Number.isFinite(runningCards) || runningCards <= 0) {
		return "Idle";
	}
	return runningCards === 1 ? "1 card running" : `${Math.trunc(runningCards)} cards running`;
}
