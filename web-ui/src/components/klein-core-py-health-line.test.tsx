import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchKleinCorePyHealthMock = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/runtime-config-query", () => ({
	fetchKleinCorePyHealth: fetchKleinCorePyHealthMock,
}));

import { KleinCorePyHealthLine } from "@/components/klein-core-py-health-line";

describe("KleinCorePyHealthLine", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchKleinCorePyHealthMock.mockReset();
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("shows Running with the endpoint when the core is enabled and reachable", async () => {
		fetchKleinCorePyHealthMock.mockResolvedValue({
			enabled: true,
			reachable: true,
			sidecarUrl: "http://127.0.0.1:3585",
		});
		await act(async () => {
			root.render(<KleinCorePyHealthLine workspaceId="ws-1" />);
			await Promise.resolve();
		});
		expect(container.textContent).toContain("Python core");
		expect(container.textContent).toContain("Running");
		expect(container.textContent).toContain("http://127.0.0.1:3585");
		expect(fetchKleinCorePyHealthMock).toHaveBeenCalledWith("ws-1");
	});

	it("shows Disabled with the opt-in hint when the core is off", async () => {
		fetchKleinCorePyHealthMock.mockResolvedValue({
			enabled: false,
			reachable: false,
			sidecarUrl: "http://127.0.0.1:3585",
		});
		await act(async () => {
			root.render(<KleinCorePyHealthLine workspaceId={null} />);
			await Promise.resolve();
		});
		expect(container.textContent).toContain("Disabled");
		expect(container.textContent).toContain("NKLEIN_CORE_PY=1");
	});

	it("shows Not reachable when enabled but the probe fails", async () => {
		fetchKleinCorePyHealthMock.mockResolvedValue({
			enabled: true,
			reachable: false,
			sidecarUrl: "http://127.0.0.1:3585",
		});
		await act(async () => {
			root.render(<KleinCorePyHealthLine workspaceId="ws-1" />);
			await Promise.resolve();
		});
		expect(container.textContent).toContain("Not reachable");
	});
});
