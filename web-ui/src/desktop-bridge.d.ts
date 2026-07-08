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
}

interface Window {
	desktop?: DesktopBridge;
}
