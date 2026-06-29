import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { CardSelection } from "@/types";
import { buildTaskActivitySteps, formatDiagnosticTime, getActivityToneClassName } from "./task-activity-model";

describe("formatDiagnosticTime", () => {
	it("returns 'unknown' for a non-finite timestamp, else an HH:MM time", () => {
		expect(formatDiagnosticTime(Number.NaN)).toBe("unknown");
		expect(formatDiagnosticTime(Number.POSITIVE_INFINITY)).toBe("unknown");
		const formatted = formatDiagnosticTime(Date.UTC(2026, 0, 1, 13, 37));
		expect(formatted).not.toBe("unknown");
		expect(formatted).toMatch(/\d{1,2}:\d{2}/);
	});
});

describe("getActivityToneClassName", () => {
	it("maps each tone to a distinct class", () => {
		const classes = (["active", "done", "waiting", "issue", "muted"] as const).map(getActivityToneClassName);
		expect(new Set(classes).size).toBe(5);
	});
});

describe("buildTaskActivitySteps", () => {
	const selection = (columnId: string, card: Record<string, unknown> = {}): CardSelection =>
		({ card: { id: "t", ...card }, column: { id: columnId, title: columnId } }) as unknown as CardSelection;

	it("marks Planning active in the planning column and pending Routing without a model", () => {
		const steps = buildTaskActivitySteps(selection("planning", { startInPlanMode: true }), null);
		const planning = steps.find((s) => s.label === "Planning");
		expect(planning).toMatchObject({ status: "In planning", tone: "active", detail: "Plan mode requested" });
		expect(steps.find((s) => s.label === "Routing")?.tone).toBe("waiting");
	});

	it("marks Planning done outside the planning column, and Routing known when a model is known", () => {
		const summary = { providerId: "lmstudio", modelId: "m", state: "awaiting_review" } as RuntimeTaskSessionSummary;
		const steps = buildTaskActivitySteps(selection("in_progress"), summary);
		expect(steps.find((s) => s.label === "Planning")?.tone).toBe("done");
		expect(steps.find((s) => s.label === "Routing")?.status).toBe("Known");
	});
});
