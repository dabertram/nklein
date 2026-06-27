import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeProjectSummary } from "@/runtime/types";
import { ProjectRow } from "./project-row";

const BASE_PROJECT: RuntimeProjectSummary = {
	id: "p1",
	name: "Demo",
	path: "/tmp/demo",
	taskCounts: { backlog: 0, planning: 0, in_progress: 0, review: 0, completed: 0, trash: 0 },
	runningSessionCount: 0,
	queuedSessionCount: 0,
};

function renderRow(project: RuntimeProjectSummary, isCurrent = false): { container: HTMLDivElement; root: Root } {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			<ProjectRow
				project={project}
				isCurrent={isCurrent}
				removingProjectId={null}
				onSelect={vi.fn()}
				onRemove={vi.fn()}
				onOpenSettings={vi.fn()}
			/>,
		);
	});
	return { container, root };
}

describe("ProjectRow live activity badge", () => {
	let mounted: { container: HTMLDivElement; root: Root } | null = null;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(() => {
		if (mounted) {
			act(() => mounted?.root.unmount());
			mounted.container.remove();
			mounted = null;
		}
	});

	it("shows a pulsing green 'running' badge when agents are on a model", () => {
		mounted = renderRow({ ...BASE_PROJECT, runningSessionCount: 2 });
		expect(mounted.container.textContent).toContain("2 running");
		const pulse = mounted.container.querySelector(".animate-pulse");
		expect(pulse).not.toBeNull();
		expect(pulse?.className).toContain("bg-status-green");
	});

	it("appends the queued count to a running badge", () => {
		mounted = renderRow({ ...BASE_PROJECT, runningSessionCount: 1, queuedSessionCount: 3 });
		expect(mounted.container.textContent).toContain("1 running");
		expect(mounted.container.textContent).toContain("+3");
	});

	it("shows a steady gold 'queued' badge when nothing is running yet (surfaces the capacity bottleneck)", () => {
		mounted = renderRow({ ...BASE_PROJECT, queuedSessionCount: 4 });
		expect(mounted.container.textContent).toContain("4 queued");
		// Queued-only is a waiting state: gold, not pulsing.
		expect(mounted.container.querySelector(".animate-pulse")).toBeNull();
		expect(mounted.container.querySelector(".bg-status-gold")).not.toBeNull();
	});

	it("renders no live badge when there is no active work", () => {
		mounted = renderRow(BASE_PROJECT);
		expect(mounted.container.textContent).not.toContain("running");
		expect(mounted.container.textContent).not.toContain("queued");
	});
});
