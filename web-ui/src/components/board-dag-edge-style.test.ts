import { describe, expect, it } from "vitest";
import { classifyDagEdge, dagEdgeStyle } from "./board-dag-edge-style";

const node = (columnId: string, extra: { running?: boolean; failed?: boolean } = {}) =>
	({ columnId, running: extra.running ?? false, failed: extra.failed ?? false }) as never;

describe("classifyDagEdge (David 2026-09-05: finished green, problem red, active blue)", () => {
	const base = { isCycle: false, isCritical: false, isSatisfied: false };
	it("colours by the prerequisite's state: finished, active, pending", () => {
		const nodeById = new Map([
			["done", node("completed")],
			["working", node("in_progress", { running: true })],
			["reviewing", node("review")],
			["queued", node("planning")],
			["dep", node("planning")],
		]);
		expect(classifyDagEdge({ ...base, edge: { fromTaskId: "dep", toTaskId: "done" }, nodeById })).toBe("finished");
		expect(classifyDagEdge({ ...base, edge: { fromTaskId: "dep", toTaskId: "working" }, nodeById })).toBe("active");
		expect(classifyDagEdge({ ...base, edge: { fromTaskId: "dep", toTaskId: "reviewing" }, nodeById })).toBe("active");
		expect(classifyDagEdge({ ...base, edge: { fromTaskId: "dep", toTaskId: "queued" }, nodeById })).toBe("pending");
		// A retired (satisfied) edge is finished even when the prerequisite node is gone from the graph.
		expect(
			classifyDagEdge({ ...base, isSatisfied: true, edge: { fromTaskId: "dep", toTaskId: "gone" }, nodeById }),
		).toBe("finished");
	});

	it("paints a problem on either end red, ahead of critical/finished/active", () => {
		const nodeById = new Map([
			["parked", node("review", { failed: true })],
			["done", node("completed")],
			["dep", node("planning")],
		]);
		expect(
			classifyDagEdge({ ...base, isCritical: true, edge: { fromTaskId: "dep", toTaskId: "parked" }, nodeById }),
		).toBe("problem");
		expect(classifyDagEdge({ ...base, edge: { fromTaskId: "parked", toTaskId: "done" }, nodeById })).toBe("problem");
		expect(classifyDagEdge({ ...base, isCycle: true, edge: { fromTaskId: "dep", toTaskId: "done" }, nodeById })).toBe(
			"problem",
		);
		expect(
			classifyDagEdge({ ...base, isCritical: true, edge: { fromTaskId: "dep", toTaskId: "done" }, nodeById }),
		).toBe("critical");
	});

	it("maps statuses to the theme tokens", () => {
		const options = { isRouted: false, isSatisfied: false, isCycle: false };
		expect(dagEdgeStyle("finished", options).stroke).toBe("var(--color-status-green)");
		expect(dagEdgeStyle("problem", { ...options, isCycle: true })).toMatchObject({
			stroke: "var(--color-status-red)",
			strokeDasharray: "6 4",
		});
		expect(dagEdgeStyle("active", options).stroke).toBe("var(--color-accent)");
		expect(dagEdgeStyle("critical", options).stroke).toBe("var(--color-status-gold)");
		expect(dagEdgeStyle("finished", { ...options, isSatisfied: true })).toMatchObject({
			strokeDasharray: "5 3",
			strokeOpacity: 0.75,
		});
		expect(dagEdgeStyle("pending", { ...options, isRouted: true }).strokeOpacity).toBeLessThan(0.2);
	});
});
