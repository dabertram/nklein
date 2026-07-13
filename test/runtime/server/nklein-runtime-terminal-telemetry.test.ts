import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	loadWorkspaceState: vi.fn(async (_p: string) => ({ board: { columns: [{ cards: [{ id: "t1" }] }] } })),
	loadRuntimeConfig: vi.fn(async (_p: string) => ({ cfg: true })),
	recordModelPerformanceObservation: vi.fn(async (_i: unknown) => {}),
	recordKnowledgeToolUsageObservation: vi.fn(async (_i: unknown) => {}),
	didTaskConsultKnowledge: vi.fn(async (_taskId: string) => true),
	deriveTaskFitnessRecord: vi.fn(
		(_i: unknown) =>
			({
				key: { modelKey: "lmstudio/m" },
				outcome: { success: true },
			}) as unknown,
	),
	recordTaskFitnessOutcome: vi.fn(async (_k: unknown, _o: unknown) => {}),
	persistModelBehaviorOutcome: vi.fn(async (_k: unknown, _o: unknown) => {}),
}));

vi.mock("../../../src/state/workspace-state", () => ({ loadWorkspaceState: h.loadWorkspaceState }));
vi.mock("../../../src/config/runtime-config", () => ({ loadRuntimeConfig: h.loadRuntimeConfig }));
vi.mock("../../../src/telemetry/model-performance-stats", () => ({
	recordModelPerformanceObservation: h.recordModelPerformanceObservation,
}));
vi.mock("../../../src/telemetry/knowledge-tool-usage-stats", () => ({
	recordKnowledgeToolUsageObservation: h.recordKnowledgeToolUsageObservation,
	didTaskConsultKnowledge: h.didTaskConsultKnowledge,
}));
vi.mock("../../../src/nklein-agent/task-fitness-recording", () => ({
	deriveTaskFitnessRecord: h.deriveTaskFitnessRecord,
}));
vi.mock("../../../src/telemetry/fitness-table-store", () => ({ recordTaskFitnessOutcome: h.recordTaskFitnessOutcome }));
// (F1.15c: the terminal telemetry no longer folds board attempts into the fitness store — the ledger projection
// carries board evidence; the mock above just proves the write is GONE.)
vi.mock("../../../src/telemetry/model-behavior-profile-store", () => ({
	persistModelBehaviorOutcome: h.persistModelBehaviorOutcome,
}));

import { createRuntimeTerminalTelemetryRecorders } from "../../../src/server/nklein-runtime-terminal-telemetry";

const scope = { workspaceId: "ws", workspacePath: "/ws" } as never;
const summary = (over: Record<string, unknown> = {}) => ({ taskId: "t1", startedAt: 1, ...over }) as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe("createRuntimeTerminalTelemetryRecorders", () => {
	it("records model performance + the behavior outcome; the board fitness fold is GONE (F1.15c)", async () => {
		const warn = vi.fn();
		const rec = createRuntimeTerminalTelemetryRecorders({ warn });
		rec.recordModelPerformance(scope, summary({ taskId: "fresh-a", startedAt: 100 }));
		await flush();
		expect(h.recordModelPerformanceObservation).toHaveBeenCalledOnce();
		// F1.15c: board attempts reach fitness through the ledger projection, never this store write.
		expect(h.recordTaskFitnessOutcome).not.toHaveBeenCalled();
		expect(h.persistModelBehaviorOutcome).toHaveBeenCalledWith("lmstudio/m", { kind: "success" });
		expect(warn).not.toHaveBeenCalled();
	});

	it("folds the behavior outcome AT MOST once per (taskId, startedAt) run", async () => {
		const rec = createRuntimeTerminalTelemetryRecorders({ warn: vi.fn() });
		const s = summary({ taskId: "dedup-b", startedAt: 200 });
		rec.recordModelPerformance(scope, s);
		await flush();
		rec.recordModelPerformance(scope, s); // same run re-emitted
		await flush();
		expect(h.recordModelPerformanceObservation).toHaveBeenCalledTimes(2); // perf recorded each time
		expect(h.persistModelBehaviorOutcome).toHaveBeenCalledOnce(); // but the terminal fold is deduped
	});

	it("records knowledge tool usage", async () => {
		const rec = createRuntimeTerminalTelemetryRecorders({ warn: vi.fn() });
		rec.recordKnowledgeToolUsage(scope, summary({ taskId: "know-c" }));
		await flush();
		expect(h.recordKnowledgeToolUsageObservation).toHaveBeenCalledOnce();
	});

	it("routes an internal failure to warn without throwing", async () => {
		h.recordModelPerformanceObservation.mockRejectedValueOnce(new Error("boom"));
		const warn = vi.fn();
		const rec = createRuntimeTerminalTelemetryRecorders({ warn });
		rec.recordModelPerformance(scope, summary({ taskId: "warn-d", startedAt: 300 }));
		await flush();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("warn-d"));
	});
});
