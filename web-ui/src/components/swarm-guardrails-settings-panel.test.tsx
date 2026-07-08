import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swarmGuardrailsToInputs } from "@/components/runtime-settings-swarm-guardrails";
import { SwarmGuardrailsSettingsPanel } from "@/components/swarm-guardrails-settings-panel";
import type { RuntimeModelRoles, RuntimeSwarmGuardrails } from "@/runtime/types";

function renderPanel(
	root: Root,
	props: {
		guardrails?: RuntimeSwarmGuardrails;
		modelRoles?: RuntimeModelRoles;
	},
): void {
	root.render(
		<SwarmGuardrailsSettingsPanel
			value={swarmGuardrailsToInputs(props.guardrails ?? DEFAULT_RUNTIME_SWARM_GUARDRAILS)}
			onChange={vi.fn()}
			maxConcurrentTasks="3"
			sandboxMaxContainers="3"
			sandboxPool={{ effectiveParallelism: 3, poolCapacityLabel: "3 slots", memoryGbLabel: "4 GB" }}
			lostHeartbeatPolicy="park"
			decompositionAutoApplyEnabled={true}
			modelRoles={props.modelRoles ?? {}}
		/>,
	);
}

describe("SwarmGuardrailsSettingsPanel latency posture", () => {
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
		act(() => root.unmount());
		container.remove();
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	it("shows the quality-over-latency profile for distinct role models on default guardrails", async () => {
		await act(async () => {
			renderPanel(root, {
				modelRoles: {
					worker: { providerId: "lmstudio", modelId: "coder" },
					architect: { providerId: "lmstudio", modelId: "reasoner" },
				},
			});
			await Promise.resolve();
		});

		const text = container.textContent ?? "";
		expect(text).toContain("Latency posture");
		expect(text).toContain("Quality over latency");
		expect(text).toContain("48 turns");
		expect(text).toContain("8h wall time");
	});

	it("shows manual guardrails when the user edits the limits", async () => {
		await act(async () => {
			renderPanel(root, {
				guardrails: {
					...DEFAULT_RUNTIME_SWARM_GUARDRAILS,
					maxAutonomousTurnsPerTask: DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask + 1,
				},
				modelRoles: {
					worker: { providerId: "lmstudio", modelId: "coder" },
					architect: { providerId: "lmstudio", modelId: "reasoner" },
				},
			});
			await Promise.resolve();
		});

		expect(container.textContent ?? "").toContain("Manual guardrails");
	});

	it("shows the single-model default when roles do not name distinct models", async () => {
		await act(async () => {
			renderPanel(root, {
				modelRoles: {
					worker: { providerId: "lmstudio", modelId: "coder" },
					architect: { providerId: "lmstudio", modelId: "coder" },
				},
			});
			await Promise.resolve();
		});

		expect(container.textContent ?? "").toContain("Single-model default");
	});
});
