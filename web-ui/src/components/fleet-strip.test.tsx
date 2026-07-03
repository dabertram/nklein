import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FleetStrip } from "@/components/fleet-strip";
import type { FleetGroup } from "@/components/fleet-strip-model";

describe("FleetStrip", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("renders a machine header per group and a row per model with its role, card, lineage, and tok/s", () => {
		const groups: FleetGroup[] = [
			{
				endpointLabel: "m5max",
				rows: [
					{
						modelId: "gpt-oss-27b",
						servedId: "brain27",
						lineage: "gpt-oss",
						role: "architect",
						drivingTaskId: "decompose",
						drivingCardTitle: "Decompose · buildout",
						isSpec: false,
						state: "running",
						tokensPerSecond: 41,
					},
					{
						modelId: "ornith9",
						servedId: "ornith9-m5",
						lineage: "qwen",
						role: null,
						drivingTaskId: null,
						drivingCardTitle: null,
						isSpec: false,
						state: "idle",
						tokensPerSecond: null,
					},
				],
			},
			{
				endpointLabel: "legion5pro",
				rows: [
					{
						modelId: "qwen-coder",
						servedId: "coder-gpu",
						lineage: "qwen",
						role: "worker",
						drivingTaskId: "validate",
						drivingCardTitle: "Validate goal settings",
						isSpec: false,
						state: "running",
						tokensPerSecond: 55,
					},
				],
			},
		];

		act(() => {
			root.render(<FleetStrip groups={groups} />);
		});

		const text = container.textContent ?? "";
		expect(text).toContain("m5max");
		expect(text).toContain("legion5pro");
		expect(text).toContain("brain27");
		expect(text).toContain("arch");
		expect(text).toContain("Decompose · buildout");
		expect(text).toContain("41 tok/s");
		// The idle row shows "idle" and an em-dash for speed.
		expect(text).toContain("idle");
		expect(text).toContain("—");
		// The worker row on the second machine.
		expect(text).toContain("coder-gpu");
		expect(text).toContain("wrk");
		expect(text).toContain("55 tok/s");

		const liveness = container.querySelectorAll('[aria-label="running"]');
		expect(liveness.length).toBe(2);
		const idleDots = container.querySelectorAll('[aria-label="idle"]');
		expect(idleDots.length).toBe(1);
	});

	it("marks a ::spec row with a dashed violet liveness dot and an A/B badge", () => {
		const groups: FleetGroup[] = [
			{
				endpointLabel: "m5max",
				rows: [
					{
						modelId: "qwen3-4b-a",
						servedId: "qwop4b-a",
						lineage: "qwen",
						role: "worker",
						drivingTaskId: "classify",
						drivingCardTitle: "Classify trends",
						isSpec: true,
						state: "running",
						tokensPerSecond: 33,
					},
				],
			},
		];

		act(() => {
			root.render(<FleetStrip groups={groups} />);
		});

		expect(container.textContent ?? "").toContain("A/B spec");
		expect(container.querySelectorAll('[aria-label="speculative session"]').length).toBe(1);
	});

	it("shows an empty-state message when no models are loaded", () => {
		act(() => {
			root.render(<FleetStrip groups={[]} />);
		});
		expect(container.querySelector('[data-testid="fleet-strip-empty"]')).not.toBeNull();
		expect(container.textContent ?? "").toContain("No models loaded.");
	});
});
