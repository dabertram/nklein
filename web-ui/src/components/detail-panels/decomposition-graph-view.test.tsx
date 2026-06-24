import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DecompositionGraphView } from "@/components/detail-panels/decomposition-graph-view";

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

function render(input: string | null, hasError = false): void {
	act(() => {
		root.render(<DecompositionGraphView input={input} hasError={hasError} />);
	});
}

describe("DecompositionGraphView", () => {
	const graph = JSON.stringify({
		slug: "daw",
		tasks: [
			{ id: "timebase-impl", title: "Implement TempoMap", dependsOn: [] },
			{ id: "timebase-tests", title: "Expand golden tests", dependsOn: ["timebase-impl"] },
		],
	});

	it("renders a node per card and an edge per dependency", () => {
		render(graph);
		const view = container.querySelector('[data-testid="decomposition-graph-view"]');
		expect(view).not.toBeNull();
		// One <rect> per card node, one <path> per dependency edge.
		expect(container.querySelectorAll("svg rect")).toHaveLength(2);
		expect(container.querySelectorAll("svg path")).toHaveLength(1);
		expect(container.textContent).toContain("Implement TempoMap");
		expect(container.textContent).toContain("2 cards · 1 dep");
	});

	it("flags a failed graph but still renders it", () => {
		render(graph, true);
		expect(container.textContent).toContain("failed validation");
		expect(container.querySelectorAll("svg rect")).toHaveLength(2);
	});

	it("renders nothing for malformed or empty input", () => {
		render("not json");
		expect(container.querySelector('[data-testid="decomposition-graph-view"]')).toBeNull();
		render(JSON.stringify({ slug: "x" }));
		expect(container.querySelector('[data-testid="decomposition-graph-view"]')).toBeNull();
		render(null);
		expect(container.querySelector('[data-testid="decomposition-graph-view"]')).toBeNull();
	});

	it("ignores dependency ids that are not cards in the graph (no dangling edges)", () => {
		render(
			JSON.stringify({
				tasks: [{ id: "a", title: "A", dependsOn: ["ghost", "a"] }],
			}),
		);
		expect(container.querySelectorAll("svg rect")).toHaveLength(1);
		// "ghost" is not a node and the self-edge is dropped → no edges.
		expect(container.querySelectorAll("svg path")).toHaveLength(0);
	});
});
