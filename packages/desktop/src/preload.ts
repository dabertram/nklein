import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
	platform: process.platform,

	openProjectWindow(projectId: string): void {
		ipcRenderer.send("open-project-window", projectId);
	},

	restartRuntime(): void {
		ipcRenderer.send("restart-runtime");
	},

	/** Read whether !Klein is set to start on boot (reads the live OS state). */
	getAutostart(): Promise<boolean> {
		return ipcRenderer.invoke("get-autostart");
	},

	/** Enable/disable start-on-boot; resolves to `{ ok }` (with an `error` message on failure). */
	setAutostart(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
		return ipcRenderer.invoke("set-autostart", enabled);
	},

	/** Read the persisted LAN-serving opt-in (§ desktop app #2). */
	getNetworkAccess(): Promise<boolean> {
		return ipcRenderer.invoke("get-network-access");
	},

	/**
	 * Persist the LAN-serving opt-in and stage the matching runtime bind. Takes effect on the
	 * next runtime restart (call `restartRuntime()` after a confirming prompt). Resolves to
	 * `{ ok, enabled }` (with an `error` message on failure).
	 */
	setNetworkAccess(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; error?: string }> {
		return ipcRenderer.invoke("set-network-access", enabled);
	},
} as const;

contextBridge.exposeInMainWorld("desktop", desktopApi);

export type DesktopApi = typeof desktopApi;
