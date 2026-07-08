/**
 * System-tray / menu-bar applet — the thin EFFECTFUL layer (§ desktop app #13.1). Maps the pure {@link buildTrayMenuTemplate}
 * model onto a real Electron `Tray` + `Menu`, wiring each item's command to an injected handler. All the decision logic
 * (labels, enabled state, tooltip) is tested in tray-menu.ts; this file only touches Electron GUI objects.
 */

import { Menu, type MenuItemConstructorOptions, Tray, nativeImage } from "electron";
import { type TrayCommand, type TrayState, buildTrayMenuTemplate, buildTrayTooltip } from "./tray-menu.js";

/** Handlers the tray commands invoke. */
export interface TrayHandlers {
	/** Open / focus the main !Klein window. */
	open: () => void;
	/** Toggle autonomous work paused/running. */
	togglePause: () => void;
	/** Quit the app. */
	quit: () => void;
}

/** A live tray handle: push new state to re-render, or tear it down. */
export interface AppTray {
	update(state: TrayState): void;
	destroy(): void;
}

/** Load the tray icon; a missing/unreadable path yields an empty image so tray creation never throws. */
function loadTrayIcon(iconPath: string): Electron.NativeImage {
	try {
		const image = nativeImage.createFromPath(iconPath);
		return image.isEmpty() ? nativeImage.createEmpty() : image;
	} catch {
		return nativeImage.createEmpty();
	}
}

/**
 * Create the app tray. Renders the {@link buildTrayMenuTemplate} for `initialState`, wires the icon-click to `open`, and
 * returns a handle whose `update(state)` re-renders the menu + tooltip (e.g. when activity or the pause flag changes).
 */
export function createAppTray(iconPath: string, handlers: TrayHandlers, initialState: TrayState): AppTray {
	const tray = new Tray(loadTrayIcon(iconPath));

	const dispatch = (command: TrayCommand): void => {
		if (command === "open") handlers.open();
		else if (command === "toggle-pause") handlers.togglePause();
		else handlers.quit();
	};

	const render = (state: TrayState): void => {
		const template: MenuItemConstructorOptions[] = buildTrayMenuTemplate(state).map((item) =>
			item.type === "separator"
				? { type: "separator" }
				: {
						label: item.label,
						enabled: item.enabled,
						click: item.command ? () => dispatch(item.command as TrayCommand) : undefined,
					},
		);
		tray.setContextMenu(Menu.buildFromTemplate(template));
		tray.setToolTip(buildTrayTooltip(state));
	};

	render(initialState);
	// Clicking the tray icon itself opens the app (natural on Windows/Linux; harmless on macOS where the menu shows).
	tray.on("click", () => handlers.open());

	return {
		update: render,
		destroy: () => {
			if (!tray.isDestroyed()) tray.destroy();
		},
	};
}
