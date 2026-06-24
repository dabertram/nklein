import type { AgentRulesetsConfigPayload } from "@runtime-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRulesetsSettingsPanel } from "@/components/agent-rulesets-settings-panel";

const baseValue: AgentRulesetsConfigPayload = {
	capability: { globalPreset: "fully_open" },
	delivery: { globalPreset: "fully_open" },
};

function setSelect(select: HTMLSelectElement, value: string): void {
	select.value = value;
	Simulate.change(select);
}

describe("AgentRulesetsSettingsPanel", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("renders both dials with global preset + per-role override selects", () => {
		act(() => root.render(<AgentRulesetsSettingsPanel value={baseValue} onChange={() => {}} />));
		expect(container.textContent).toContain("Capability");
		expect(container.textContent).toContain("Delivery autonomy");
		expect(container.querySelector('[aria-label="Capability global preset"]')).toBeInstanceOf(HTMLSelectElement);
		expect(container.querySelector('[aria-label="Delivery autonomy Architect override"]')).toBeInstanceOf(
			HTMLSelectElement,
		);
	});

	it("changing the global preset emits an updated config", () => {
		const onChange = vi.fn();
		act(() => root.render(<AgentRulesetsSettingsPanel value={baseValue} onChange={onChange} />));
		const select = container.querySelector('[aria-label="Capability global preset"]') as HTMLSelectElement;
		act(() => setSelect(select, "strict"));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ capability: expect.objectContaining({ globalPreset: "strict" }) }),
		);
	});

	it("adds and clears a per-role override", () => {
		const onChange = vi.fn();
		act(() => root.render(<AgentRulesetsSettingsPanel value={baseValue} onChange={onChange} />));
		const reviewer = container.querySelector('[aria-label="Capability Reviewer override"]') as HTMLSelectElement;
		act(() => setSelect(reviewer, "medium"));
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				capability: { globalPreset: "fully_open", roleOverrides: { reviewer: "medium" } },
			}),
		);

		// With an existing override, selecting "Use global" removes it.
		onChange.mockClear();
		act(() =>
			root.render(
				<AgentRulesetsSettingsPanel
					value={{
						...baseValue,
						capability: { globalPreset: "fully_open", roleOverrides: { reviewer: "medium" } },
					}}
					onChange={onChange}
				/>,
			),
		);
		const reviewer2 = container.querySelector('[aria-label="Capability Reviewer override"]') as HTMLSelectElement;
		act(() => setSelect(reviewer2, ""));
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ capability: { globalPreset: "fully_open" } }),
		);
	});
});
