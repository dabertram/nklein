import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FieldReportPanel } from "@/components/field-report-panel";

const candidatesQuery = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			fieldReportCandidates: { query: candidatesQuery },
		},
	}),
}));

function flush() {
	return act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

const CANDIDATES = {
	candidates: [
		{
			key: "observations.count",
			layer: "A" as const,
			bytes: "3 observations over 2 day(s)",
			reveals: "how much telemetry exists — counts only",
		},
		{
			key: "verbatim.runtime_error.1",
			layer: "C" as const,
			bytes: "crash while reading <path:1>",
			reveals: "the exact (redacted) text of a recorded error",
		},
	],
};

describe("FieldReportPanel (P16.7b)", () => {
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
		candidatesQuery.mockReset();
		vi.useFakeTimers();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	async function mount() {
		await act(async () => {
			root.render(<FieldReportPanel workspaceId="ws-1" open />);
		});
		await flush();
	}

	it("defaults Layer A included and Layer C excluded, and shows RAW bytes for every item", async () => {
		candidatesQuery.mockResolvedValue(CANDIDATES);
		await mount();
		const indicator = container.querySelector('[data-testid="field-report-reveals-now"]');
		expect(indicator?.textContent).toContain("1 of 2 item(s) included");
		expect(indicator?.textContent).toContain("how much telemetry exists");
		expect(indicator?.textContent).not.toContain("exact (redacted) text");
		// Raw bytes are visible for EXCLUDED items too — the user decides by reading bytes, not descriptions.
		expect(container.textContent).toContain("crash while reading <path:1>");
	});

	it("toggling an item updates the running disclosure indicator and invalidates a rendered draft", async () => {
		candidatesQuery.mockResolvedValue(CANDIDATES);
		await mount();
		const renderButton = container.querySelector<HTMLButtonElement>('[data-testid="field-report-render-draft"]');
		await act(async () => {
			renderButton?.click();
		});
		expect(container.querySelector('[data-testid="field-report-draft"]')).not.toBeNull();
		const verbatimToggle = container.querySelector<HTMLInputElement>(
			'input[aria-label="Include verbatim.runtime_error.1"]',
		);
		await act(async () => {
			verbatimToggle?.click();
		});
		// The previous draft described a different byte set — consent does not carry over.
		expect(container.querySelector('[data-testid="field-report-draft"]')).toBeNull();
		const indicator = container.querySelector('[data-testid="field-report-reveals-now"]');
		expect(indicator?.textContent).toContain("2 of 2 item(s) included");
		expect(indicator?.textContent).toContain("exact (redacted) text");
	});

	it("renders the draft with the provenance statement and never offers a submit path", async () => {
		candidatesQuery.mockResolvedValue(CANDIDATES);
		await mount();
		await act(async () => {
			container.querySelector<HTMLButtonElement>('[data-testid="field-report-render-draft"]')?.click();
		});
		const draft = container.querySelector('[data-testid="field-report-draft"]');
		expect(draft?.textContent).toContain("!Klein did not send this — a person did.");
		expect(draft?.textContent).toContain("3 observations over 2 day(s)");
		// The only actions are copy + an external link the user drives; no button submits anything.
		expect(container.textContent).not.toMatch(/submit report|send report/i);
		const link = container.querySelector<HTMLAnchorElement>('a[href*="issues/new"]');
		expect(link).not.toBeNull();
	});

	it("surfaces the hidden-character refusal as a blocking explained state and honours the acknowledgement", async () => {
		candidatesQuery.mockResolvedValue({
			candidates: [
				{
					key: "observations.count",
					layer: "A" as const,
					bytes: "clean",
					reveals: "counts only",
				},
				{
					key: "verbatim.tool_error.1",
					layer: "C" as const,
					bytes: `looks harmless${"\u200B"} but is not`,
					reveals: "exact text",
				},
			],
		});
		await mount();
		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Include verbatim.tool_error.1"]')?.click();
		});
		await act(async () => {
			container.querySelector<HTMLButtonElement>('[data-testid="field-report-render-draft"]')?.click();
		});
		const refusal = container.querySelector('[data-testid="field-report-refusal"]');
		expect(refusal?.textContent).toContain("Draft refused");
		expect(refusal?.textContent).toContain("U+200B");
		expect(container.querySelector('[data-testid="field-report-draft"]')).toBeNull();
		// Explicit acknowledgement re-renders the draft over the SAME byte set.
		await act(async () => {
			const acknowledge = refusal?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			acknowledge?.click();
		});
		expect(container.querySelector('[data-testid="field-report-draft"]')).not.toBeNull();
	});
});
