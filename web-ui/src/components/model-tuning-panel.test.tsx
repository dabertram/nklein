import type { RuntimeModelTuningResponse } from "@runtime-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelTuningPanel } from "@/components/model-tuning-panel";

function tuning(models: RuntimeModelTuningResponse["models"]): RuntimeModelTuningResponse {
	return { generatedAt: 1, models };
}

describe("ModelTuningPanel", () => {
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

	it("renders one row per model with a short id and the three budgets", () => {
		act(() => {
			root.render(
				<ModelTuningPanel
					tuning={tuning([
						{
							modelId: "lmstudio:qwopus3.5-9b-coder-mtp",
							contextCapTokens: 84615,
							answerBudgetTokens: 8835,
							retryBudget: 1,
							answerBudgetConfident: true,
							sampleCount: 18,
						},
					])}
				/>,
			);
		});
		const rows = container.querySelectorAll('[data-testid="model-tuning-row"]');
		expect(rows).toHaveLength(1);
		const text = rows[0]?.textContent ?? "";
		expect(text).toContain("qwopus3.5-9b-coder-mtp"); // provider prefix dropped
		expect(text).toContain("84,615");
		expect(text).toContain("8,835");
	});

	it("renders an em dash for null budgets and a (low) marker for low-confidence answer budgets", () => {
		act(() => {
			root.render(
				<ModelTuningPanel
					tuning={tuning([
						{
							modelId: "m",
							contextCapTokens: null,
							answerBudgetTokens: 200,
							retryBudget: null,
							answerBudgetConfident: false,
							sampleCount: 2,
						},
					])}
				/>,
			);
		});
		const text = container.querySelector('[data-testid="model-tuning-row"]')?.textContent ?? "";
		expect(text).toContain("—"); // null context cap + null retry budget
		expect(text).toContain("(low)"); // low-confidence answer budget marker
	});

	it("renders nothing when there are no models (empty history)", () => {
		act(() => {
			root.render(<ModelTuningPanel tuning={tuning([])} />);
		});
		expect(container.querySelector('[data-testid="model-tuning-recommendations"]')).toBeNull();
	});
});
