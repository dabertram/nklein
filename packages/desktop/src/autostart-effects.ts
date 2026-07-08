/**
 * Effectful adapter for the autostart-on-boot config (§ desktop app #13.3). Turns the injected {@link AutostartEffects}
 * seam from autostart-config.ts into REAL side-effects: Electron's login-item setter (macOS/Windows) + node fs for the
 * Linux XDG `.desktop` file. Kept apart from the pure planner so the planner stays trivially unit-testable; this thin
 * layer is exercised against a temp dir.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	type AutostartEffects,
	type AutostartRequest,
	applyAutostartPlan,
	resolveAutostartPlan,
} from "./autostart-config.js";

/** The subset of Electron's `app` this needs (injected so tests don't need a real Electron runtime). */
export interface LoginItemApp {
	setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

/** Build the real {@link AutostartEffects}: Electron login-item (mac/win) + node fs (Linux `.desktop`). */
export function createAutostartEffects(app: LoginItemApp): AutostartEffects {
	return {
		setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
		writeAutostartFile: async (path, content) => {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, "utf8");
		},
		removeAutostartFile: async (path) => {
			await rm(path, { force: true }); // `force` ⇒ a missing file is not an error
		},
	};
}

/**
 * Enable/disable "start !Klein on boot" — resolve the platform plan for the request and apply it via real effects.
 * The single entry point main.ts calls from a Settings "start on boot" toggle (over IPC).
 */
export async function setAutostartEnabled(app: LoginItemApp, request: AutostartRequest): Promise<void> {
	await applyAutostartPlan(resolveAutostartPlan(request), createAutostartEffects(app));
}
