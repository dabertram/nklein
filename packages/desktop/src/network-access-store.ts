/**
 * Persistence for the LAN-serving opt-in (desktop sub-feature #2). A tiny JSON file in the app's userData dir — a
 * sibling of window-states.json — read at startup (BEFORE the runtime is spawned, so the bind host is decided up
 * front) and written when the user toggles the Settings switch. Real fs, but every function takes `userDataPath`, so
 * tests drive it against a temp dir (the window-state.ts persistence pattern).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Where the LAN-serving preference is persisted, next to the other desktop state files. */
export function resolveNetworkAccessConfigPath(userDataPath: string): string {
	return path.join(userDataPath, "network-access.json");
}

/**
 * Read the persisted LAN-serving preference. Missing / unreadable / malformed / anything-but-`{enabled:true}` ⇒ false,
 * the SAFE loopback-only default — a corrupt or hand-edited file can never accidentally expose the runtime to the LAN.
 */
export function loadNetworkAccessEnabled(userDataPath: string): boolean {
	const filePath = resolveNetworkAccessConfigPath(userDataPath);
	if (!existsSync(filePath)) {
		return false;
	}
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
		return typeof parsed === "object" && parsed !== null && (parsed as { enabled?: unknown }).enabled === true;
	} catch {
		return false;
	}
}

/** Persist the LAN-serving preference (best-effort; a write failure is surfaced to the caller). */
export function saveNetworkAccessEnabled(userDataPath: string, enabled: boolean): void {
	writeFileSync(resolveNetworkAccessConfigPath(userDataPath), `${JSON.stringify({ enabled }, null, 2)}\n`, "utf-8");
}
