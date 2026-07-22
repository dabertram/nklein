import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FleetStrip } from "@/components/fleet-strip";
import type { FleetGroup } from "@/components/fleet-strip-model";
import type { RuntimeFleetStatusResponse } from "@/runtime/types";

const resources: NonNullable<RuntimeFleetStatusResponse["resources"]> = {
	sampledAt: 1_000,
	host: {
		logicalCpuCount: 12,
		processCpuPercent: 5,
		systemCpuPercent: 25,
		processRssBytes: 2 * 1024 ** 3,
		processHeapUsedBytes: 512 * 1024 ** 2,
		systemTotalBytes: 128 * 1024 ** 3,
		systemFreeBytes: 32 * 1024 ** 3,
	},
	disk: { totalBytes: 2_000 * 1024 ** 3, freeBytes: 800 * 1024 ** 3 },
	devices: [
		{
			machineId: "m5max",
			fastMemoryCapacityBytes: 96 * 1024 ** 3,
			residentBytes: 27 * 1024 ** 3,
			residentBytesKnownCount: 1,
			residents: [
				{
					identifier: "bonsai-27b",
					modelKey: "prism/bonsai-27b",
					status: "idle",
					contextLength: 40_000,
					sizeBytes: 27 * 1024 ** 3,
				},
			],
		},
	],
	promptCache: { comparisons: 4, perfectHits: 2, averageReuseRatio: 0.8, latestReuseRatio: 1, latestAt: 900 },
	reservations: { holderCount: 1, totals: [{ kind: "kv_bytes", key: "m5max", amount: 4 * 1024 ** 3 }] },
};

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
						warmKind: null,
						activityText: null,
						activityToolName: null,
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
						warmKind: null,
						activityText: null,
						activityToolName: null,
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
						warmKind: null,
						activityText: null,
						activityToolName: null,
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
		// Idle rows CONDENSE into a per-group lineage-mix summary line; expanding it reveals the row.
		expect(text).toContain("1 idle · qwen ×1");
		expect(container.querySelectorAll('[aria-label="idle"]').length).toBe(0);
		const idleSummary = container.querySelector<HTMLButtonElement>('[data-testid="fleet-idle-summary"]');
		expect(idleSummary).not.toBeNull();
		act(() => {
			idleSummary?.click();
		});
		const expandedText = container.textContent ?? "";
		expect(expandedText).toContain("idle");
		expect(expandedText).toContain("—");
		expect(container.querySelectorAll('[aria-label="idle"]').length).toBe(1);
		// The worker row on the second machine.
		expect(expandedText).toContain("coder-gpu");
		expect(expandedText).toContain("wrk");
		expect(expandedText).toContain("55 tok/s");

		const liveness = container.querySelectorAll('[aria-label="running"]');
		expect(liveness.length).toBe(2);
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
						warmKind: null,
						activityText: null,
						activityToolName: null,
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

	it("renders honest host, capacity, residency, cache, and reservation telemetry", () => {
		act(() => {
			root.render(<FleetStrip groups={[]} resources={resources} />);
		});
		const text = container.textContent ?? "";
		expect(container.querySelector('[data-testid="fleet-resources"]')).not.toBeNull();
		expect(text).toContain("!Klein host resources");
		expect(text).toContain("96 GiB / 128 GiB");
		expect(text).toContain("25% system");
		expect(text).toContain("80% avg reuse");
		expect(text).toContain("2/4 byte-identical hits");
		expect(text).toContain("1 task hold");
		expect(text).toContain("96 GiB fast memory / VRAM");
		expect(text).toContain("bonsai-27b @40k");
		expect(text).toContain("not presented as measured free VRAM");
	});

	it("shows the driver's live activity snippet on running rows (violet, latest step only)", async () => {
		const groups: FleetGroup[] = [
			{
				endpointLabel: "local",
				rows: [
					{
						modelId: "qwen3-8b",
						servedId: "coder8",
						lineage: "qwen",
						role: "worker",
						drivingTaskId: "t1",
						drivingCardTitle: "Search bar",
						isSpec: false,
						state: "running",
						tokensPerSecond: 30,
						warmKind: null,
						activityText: "Editing src/recipes.ts",
						activityToolName: "edit_file",
					},
				],
			},
		];
		await act(async () => {
			root.render(<FleetStrip groups={groups} />);
		});
		const snippet = container.querySelector('[data-testid="fleet-row-activity"]');
		expect(snippet).not.toBeNull();
		expect(snippet?.textContent).toContain("edit_file");
		expect(snippet?.textContent).toContain("Editing src/recipes.ts");
	});
});
