import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	formatNKleinModelRegistryPanelSummary,
	NKleinModelRegistryPanel,
} from "@/components/detail-panels/nklein-model-registry-panel";
import type { RuntimeNKleinModelRegistryEntry } from "@/runtime/types";

function createModelRegistryEntry(
	overrides: Partial<RuntimeNKleinModelRegistryEntry> = {},
): RuntimeNKleinModelRegistryEntry {
	return {
		key: "ollama:qwen:local",
		providerId: "ollama",
		modelId: "qwen",
		endpoint: "http://localhost:11434",
		contextWindow: {
			advertised: null,
			observed: 16_000,
			userOverride: null,
			effective: 16_000,
		},
		speed: {
			samples: 2,
			promptTokensEwma: 1_500,
			outputTokensEwma: 75,
			totalTokensEwma: 1_575,
			prefillTokensPerSecondEwma: 800,
			decodeTokensPerSecondEwma: 40,
			ttftMsEwma: 500,
			wallTimeMsEwma: 3_000,
			wallTimeMsPer1kPromptTokensEwma: 2_000,
			lastPromptTokens: 1_000,
			lastOutputTokens: 50,
			lastWallTimeMs: 2_000,
			lastObservedAt: 120_000,
		},
		capability: {
			samples: 1,
			staticPrior: 35,
			evalScore: null,
			externalScore: null,
			observedPassRate: 1,
			effectiveScore: 68,
			lastObservedAt: 120_000,
		},
		constraints: {
			sharedEndpointId: "ollama-local",
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 10,
		updatedAt: 120_000,
		...overrides,
	};
}

function renderPanel(root: Root, element: ReactElement): void {
	root.render(element);
}

describe("NKleinModelRegistryPanel", () => {
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

	it("summarizes endpoint, context window, speed, and capability", () => {
		const summary = formatNKleinModelRegistryPanelSummary(createModelRegistryEntry(), 180_000);

		expect(summary).toBe(
			"ollama/qwen · endpoint ollama-local · window 16k · in 800 tok/s · out 40 tok/s · latency 2000 ms/1k · cap 68 · 2 samples · last 1m ago",
		);
	});

	it("renders every observed model and pins the selected model first", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinModelRegistryPanel
					entries={[
						createModelRegistryEntry({
							key: "nklein:sonnet:default",
							providerId: "nklein",
							modelId: "sonnet",
							endpoint: null,
							constraints: {
								sharedEndpointId: null,
								inputCostPerMillionTokens: null,
								outputCostPerMillionTokens: null,
							},
						}),
						createModelRegistryEntry(),
					]}
					selectedProviderId="ollama"
					selectedModelId="qwen"
					nowMs={180_000}
				/>,
			);
			await Promise.resolve();
		});

		const text = container.textContent ?? "";
		expect(text).toContain("Past telemetry");
		expect(text).toContain("ollama/qwen");
		expect(text).toContain("nklein/sonnet");
		expect(text).toContain("Endpoint: ollama-local");
		expect(text).toContain("Effective context: 16,000");
		expect(text).toContain("Context override: unknown");
		expect(text).toContain("Observed: 16,000");
		expect(text).toContain("In 800 tok/s");
		expect(text.indexOf("ollama/qwen")).toBeLessThan(text.indexOf("nklein/sonnet"));
	});

	it("shows unmeasured models and prompts for missing context windows", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinModelRegistryPanel
					entries={[
						createModelRegistryEntry({
							contextWindow: {
								advertised: null,
								observed: null,
								userOverride: null,
								effective: null,
							},
							speed: {
								...createModelRegistryEntry().speed,
								samples: 0,
								prefillTokensPerSecondEwma: null,
								decodeTokensPerSecondEwma: null,
								wallTimeMsPer1kPromptTokensEwma: null,
								lastObservedAt: null,
							},
						}),
					]}
					selectedProviderId="ollama"
					selectedModelId="qwen"
					nowMs={180_000}
				/>,
			);
			await Promise.resolve();
		});

		const text = container.textContent ?? "";
		expect(text).toContain("ollama/qwen");
		expect(text).toContain("Set context window");
		expect(text).toContain("Effective context: unknown");
		expect(text).toContain("Samples: 0");
	});

	it("saves a context-window override when controls are enabled", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		await act(async () => {
			renderPanel(
				root,
				<NKleinModelRegistryPanel
					entries={[createModelRegistryEntry()]}
					selectedProviderId="ollama"
					selectedModelId="qwen"
					nowMs={180_000}
					onContextWindowOverrideSave={onSave}
				/>,
			);
			await Promise.resolve();
		});

		const input = container.querySelector("input[aria-label='Context window override for ollama/qwen']");
		expect(input).toBeInstanceOf(HTMLInputElement);
		await act(async () => {
			if (input instanceof HTMLInputElement) {
				input.value = "64000";
				Simulate.change(input);
			}
			await Promise.resolve();
		});
		const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save"),
		);
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			saveButton?.click();
			await Promise.resolve();
		});

		expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ providerId: "ollama", modelId: "qwen" }), 64_000);
	});

	it("saves a per-model max-concurrent-requests override when enabled (§5.T)", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		await act(async () => {
			renderPanel(
				root,
				<NKleinModelRegistryPanel
					entries={[createModelRegistryEntry()]}
					selectedProviderId="ollama"
					selectedModelId="qwen"
					nowMs={180_000}
					onMaxConcurrentRequestsSave={onSave}
				/>,
			);
			await Promise.resolve();
		});

		const input = container.querySelector("input[aria-label='Max concurrent requests for ollama/qwen']");
		expect(input).toBeInstanceOf(HTMLInputElement);
		await act(async () => {
			if (input instanceof HTMLInputElement) {
				input.value = "3";
				Simulate.change(input);
			}
			await Promise.resolve();
		});
		const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save"),
		);
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			saveButton?.click();
			await Promise.resolve();
		});

		expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ providerId: "ollama", modelId: "qwen" }), 3);
	});
});
