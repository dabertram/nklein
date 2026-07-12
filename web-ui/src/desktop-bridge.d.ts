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
	/** Read whether !Klein serves on the local network (the persisted opt-in). */
	getNetworkAccess(): Promise<boolean>;
	/** Enable/disable LAN serving; `restartRequired` is true when the applying relaunch was deferred. */
	setNetworkAccess(enabled: boolean): Promise<{ ok: boolean; error?: string; restartRequired?: boolean }>;
}

interface Window {
	desktop?: DesktopBridge;
}
