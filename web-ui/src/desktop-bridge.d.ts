/**
 * Ambient type for the Electron preload bridge (`window.desktop`, from packages/desktop/src/preload.ts). Present ONLY
 * when the web UI runs inside the !Klein desktop app; `undefined` in a plain browser. Consumers must feature-detect
 * (`window.desktop?…`) so browser builds degrade gracefully.
 */
interface DesktopBridge {
	readonly platform: string;
	openProjectWindow(projectId: string): void;
	restartRuntime(): void;
	/** Read whether !Klein is set to start on boot (live OS state). */
	getAutostart(): Promise<boolean>;
	/** Enable/disable start-on-boot; resolves `{ ok }` (with an `error` message on failure). */
	setAutostart(enabled: boolean): Promise<{ ok: boolean; error?: string }>;
	/** Read the persisted LAN-serving opt-in (§ desktop app #2). */
	getNetworkAccess(): Promise<boolean>;
	/**
	 * Persist the LAN-serving opt-in and stage the matching runtime bind; takes effect on the
	 * next runtime restart (`restartRuntime()`). Resolves `{ ok, enabled }` (with an `error`
	 * message on failure).
	 */
	setNetworkAccess(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; error?: string }>;
}

interface Window {
	desktop?: DesktopBridge;
}
