import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NetworkAccessInfo, NetworkAccessSettingsSection } from "@/components/runtime-settings-network-access";

function makeBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
	return {
		platform: "darwin",
		openProjectWindow: vi.fn(),
		restartRuntime: vi.fn(),
		getAutostart: vi.fn(async () => false),
		setAutostart: vi.fn(async () => ({ ok: true })),
		getNetworkAccess: vi.fn(async () => false),
		setNetworkAccess: vi.fn(async (enabled: boolean) => ({ ok: true, enabled })),
		...overrides,
	};
}

function lanInfo(overrides: Partial<NetworkAccessInfo> = {}): NetworkAccessInfo {
	return {
		lanServing: true,
		passcodeRequired: true,
		passcode: "Abcd2345",
		publicHost: "192.168.1.25",
		port: 3484,
		origin: "http://192.168.1.25:3484",
		...overrides,
	};
}

async function flushAsync(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("NetworkAccessSettingsSection", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	async function render(props: {
		open?: boolean;
		bridge: DesktopBridge;
		fetchInfo: () => Promise<NetworkAccessInfo | null>;
	}): Promise<void> {
		await act(async () => {
			root.render(
				<NetworkAccessSettingsSection
					open={props.open ?? true}
					bridge={props.bridge}
					fetchInfo={props.fetchInfo}
				/>,
			);
		});
		await flushAsync();
	}

	function getSwitch(): HTMLButtonElement {
		const el = container.querySelector<HTMLButtonElement>("#runtime-settings-network-access");
		if (!el) throw new Error("network-access switch not rendered");
		return el;
	}

	it("reads the persisted opt-in and live state when opened, showing URL + passcode + warning", async () => {
		const bridge = makeBridge({ getNetworkAccess: vi.fn(async () => true) });
		await render({ bridge, fetchInfo: async () => lanInfo() });

		expect(getSwitch().getAttribute("data-state")).toBe("checked");
		expect(container.textContent).toContain("http://192.168.1.25:3484");
		expect(container.textContent).toContain("Abcd2345");
		expect(container.textContent).toContain("plain unencrypted HTTP");
		// Persisted and live agree — no restart prompt.
		expect(container.textContent).not.toContain("Restart the runtime");
	});

	it("stays hidden-state clean when LAN serving is fully off", async () => {
		const bridge = makeBridge();
		await render({ bridge, fetchInfo: async () => lanInfo({ lanServing: false, passcode: null, publicHost: null }) });

		expect(getSwitch().getAttribute("data-state")).toBe("unchecked");
		expect(container.textContent).not.toContain("Passcode");
		expect(container.textContent).not.toContain("Restart the runtime");
	});

	it("persists the opt-in optimistically and prompts for a restart when live state lags", async () => {
		const bridge = makeBridge();
		await render({ bridge, fetchInfo: async () => lanInfo({ lanServing: false, passcode: null, publicHost: null }) });

		await act(async () => {
			getSwitch().click();
		});
		await flushAsync();

		expect(bridge.setNetworkAccess).toHaveBeenCalledWith(true);
		expect(getSwitch().getAttribute("data-state")).toBe("checked");
		// Live runtime still loopback-bound → mismatch → restart prompt.
		expect(container.textContent).toContain("Restart the runtime to start serving on the network.");
	});

	it("reverts the switch when the desktop rejects the change", async () => {
		const bridge = makeBridge({
			setNetworkAccess: vi.fn(async () => ({ ok: false, enabled: false, error: "EACCES" })),
		});
		await render({ bridge, fetchInfo: async () => lanInfo({ lanServing: false, passcode: null, publicHost: null }) });

		await act(async () => {
			getSwitch().click();
		});
		await flushAsync();

		expect(bridge.setNetworkAccess).toHaveBeenCalledWith(true);
		expect(getSwitch().getAttribute("data-state")).toBe("unchecked");
	});

	it("restarts the runtime only after the confirming dialog", async () => {
		const bridge = makeBridge({ getNetworkAccess: vi.fn(async () => true) });
		// Persisted ON, live OFF → restart prompt visible.
		await render({ bridge, fetchInfo: async () => lanInfo({ lanServing: false, passcode: null, publicHost: null }) });

		const restartTrigger = Array.from(container.querySelectorAll("button")).find((el) =>
			el.textContent?.includes("Restart now"),
		);
		expect(restartTrigger).toBeDefined();
		await act(async () => {
			restartTrigger?.click();
		});
		expect(bridge.restartRuntime).not.toHaveBeenCalled();

		// The AlertDialog renders in a portal on document.body.
		const confirm = Array.from(document.body.querySelectorAll("button")).find((el) =>
			el.textContent?.includes("Restart runtime"),
		);
		expect(confirm).toBeDefined();
		await act(async () => {
			confirm?.click();
		});
		expect(bridge.restartRuntime).toHaveBeenCalledTimes(1);
	});

	it("explains a missing LAN address instead of showing a broken URL", async () => {
		const bridge = makeBridge({ getNetworkAccess: vi.fn(async () => true) });
		await render({ bridge, fetchInfo: async () => lanInfo({ publicHost: null }) });

		expect(container.textContent).toContain("No LAN address detected");
		expect(container.textContent).not.toContain("http://null");
	});
});
