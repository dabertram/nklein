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

	/** Read whether !Klein is set to serve on the local network (the persisted opt-in). */
	getNetworkAccess(): Promise<boolean> {
		return ipcRenderer.invoke("get-network-access");
	},

	/**
	 * Enable/disable LAN serving. Resolves to `{ ok }` (with `error` on failure); `restartRequired` is true when the
	 * user deferred the relaunch that actually rebinds the host (it applies on the next launch).
	 */
	setNetworkAccess(enabled: boolean): Promise<{ ok: boolean; error?: string; restartRequired?: boolean }> {
		return ipcRenderer.invoke("set-network-access", enabled);
	},
} as const;

contextBridge.exposeInMainWorld("desktop", desktopApi);

export type DesktopApi = typeof desktopApi;
