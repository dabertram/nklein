import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FleetPoolLossNotice, formatFleetPoolLoss } from "@/components/fleet-pool-loss-notice";

/** P0.POOLLOSS: a vanished pool model must SAY SO on the board — live 2026-09-03 nothing did for 17 hours. */
const loss = {
	modelId: "dirk-qwen3.8-27b",
	endpoint: "http://192.168.68.101:1234/v1",
	roles: ["worker"],
	lastSeenAt: 2 * 60_000,
	absentSince: 3 * 60_000,
	declaredAt: 4 * 60_000,
	lastError: { message: "500 Internal Server Error: model crashed", at: 2 * 60_000 + 30_000, sessionId: "s1" },
};

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
}

describe("FleetPoolLossNotice", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("names the vanished model, its pool, when it went and its crash signature", async () => {
		await act(async () => {
			root.render(
				<FleetPoolLossNotice
					workspaceId="ws"
					fetchHealth={async () => ({ sweptAt: 5 * 60_000, losses: [loss] })}
					pollMs={600_000}
					now={() => 13 * 60_000}
				/>,
			);
		});
		await flush();
		const notice = container.querySelector('[data-testid="fleet-pool-loss-notice"]');
		expect(notice).not.toBeNull();
		const text = notice?.textContent ?? "";
		expect(text).toContain("A fleet pool model vanished");
		expect(text).toContain("dirk-qwen3.8-27b at http://192.168.68.101:1234/v1 (worker pool) is no longer loaded");
		expect(text).toContain("(10 min)");
		expect(text).toContain("Last error: 500 Internal Server Error: model crashed");
		expect(text).toContain("Reload it in LM Studio");
	});

	it("renders nothing while every pool member is loaded, and nothing when the runtime cannot be asked", async () => {
		await act(async () => {
			root.render(
				<FleetPoolLossNotice
					workspaceId="ws"
					fetchHealth={async () => ({ sweptAt: 1, losses: [] })}
					pollMs={600_000}
				/>,
			);
		});
		await flush();
		expect(container.querySelector('[data-testid="fleet-pool-loss-notice"]')).toBeNull();
		await act(async () => {
			root.render(
				<FleetPoolLossNotice
					workspaceId="ws"
					fetchHealth={async () => {
						throw new Error("runtime down");
					}}
					pollMs={600_000}
				/>,
			);
		});
		await flush();
		expect(container.querySelector('[data-testid="fleet-pool-loss-notice"]')).toBeNull();
	});

	it("says when no crash signature exists instead of inventing one", () => {
		const line = formatFleetPoolLoss({ ...loss, lastError: null, lastSeenAt: null }, 13 * 60_000);
		expect(line).toContain("never seen loaded since the runtime started");
		expect(line).toContain("No wire error was recorded before it vanished.");
	});
});
