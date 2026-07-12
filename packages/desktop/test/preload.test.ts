/**
 * Unit tests for the preload bridge: every `window.desktop` method must talk to its IPC
 * channel with the exact name main.ts registers — a typo'd channel fails silently at
 * runtime (invoke rejects, send disappears), so the mapping is pinned here.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(async () => undefined);
const send = vi.fn();

vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld },
	ipcRenderer: { invoke, send },
}));

interface ExposedDesktopApi {
	platform: string;
	openProjectWindow(projectId: string): void;
	restartRuntime(): void;
	getAutostart(): Promise<boolean>;
	setAutostart(enabled: boolean): Promise<{ ok: boolean; error?: string }>;
	getNetworkAccess(): Promise<boolean>;
	setNetworkAccess(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; error?: string }>;
}

let api: ExposedDesktopApi;

beforeAll(async () => {
	await import("../src/preload.js");
	expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
	const [key, exposed] = exposeInMainWorld.mock.calls[0] as [string, ExposedDesktopApi];
	expect(key).toBe("desktop");
	api = exposed;
});

describe("preload desktop bridge", () => {
	it("exposes the current platform", () => {
		expect(api.platform).toBe(process.platform);
	});

	it("routes fire-and-forget commands over ipcRenderer.send", () => {
		api.openProjectWindow("project-1");
		expect(send).toHaveBeenCalledWith("open-project-window", "project-1");

		api.restartRuntime();
		expect(send).toHaveBeenCalledWith("restart-runtime");
	});

	it("routes autostart get/set over the autostart channels", async () => {
		await api.getAutostart();
		expect(invoke).toHaveBeenCalledWith("get-autostart");

		await api.setAutostart(true);
		expect(invoke).toHaveBeenCalledWith("set-autostart", true);
	});

	it("routes network-access get/set over the network-access channels (§ desktop app #2)", async () => {
		await api.getNetworkAccess();
		expect(invoke).toHaveBeenCalledWith("get-network-access");

		await api.setNetworkAccess(true);
		expect(invoke).toHaveBeenCalledWith("set-network-access", true);

		await api.setNetworkAccess(false);
		expect(invoke).toHaveBeenCalledWith("set-network-access", false);
	});
});
