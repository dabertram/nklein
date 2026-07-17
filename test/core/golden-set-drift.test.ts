import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../src/core/agent-attempt-ledger";
import { assessGoldenSetDrift } from "../../src/core/golden-set-drift";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function attempt(overrides: {
	taskId: string;
	modelId: string;
	outcome?: string;
	difficulty?: string | null;
	flow?: string | null;
	completedAt?: number;
}): AgentLedgerEvent {
	return {
		kind: "attempt",
		schemaVersion: 1,
		recordedAt: overrides.completedAt ?? NOW - DAY,
		workflowId: overrides.taskId,
		taskId: overrides.taskId,
		workspacePathHash: "hash",
		modelId: overrides.modelId,
		role: "worker",
		promptStrategy: null,
		simplificationLevel: 0,
		contextTokens: null,
		contextBudgetTarget: null,
		difficulty: overrides.difficulty ?? null,
		flow: overrides.flow ?? null,
		startedAt: (overrides.completedAt ?? NOW - DAY) - 1000,
		completedAt: overrides.completedAt ?? NOW - DAY,
		ttftMs: null,
		tokensPerSec: null,
		toolCalls: [],
		outcome: (overrides.outcome ?? "success") as never,
		qualityScore: null,
		qualityOk: null,
		retriesBefore: 0,
		salvage: null,
		artifacts: null,
		knowledge: null,
		focusStep: null,
	} as unknown as AgentLedgerEvent;
}

describe("assessGoldenSetDrift (F12.49)", () => {
	it("reports full coverage when live traffic matches the corpus composition", () => {
		const events = [
			attempt({ taskId: "corpus-1", modelId: "m-a", completedAt: NOW - 60 * DAY }),
			attempt({ taskId: "live-1", modelId: "m-a" }),
			attempt({ taskId: "live-2", modelId: "m-a" }),
		];
		const report = assessGoldenSetDrift(events, ["corpus-1"], { now: NOW });
		expect(report.drifted).toBe(false);
		expect(report.dimensions.find((d) => d.dimension === "model")?.coverage).toBe(1);
	});

	it("alerts with the uncovered categories as a mining shortlist when live traffic moves", () => {
		const events = [
			attempt({ taskId: "corpus-1", modelId: "m-old", completedAt: NOW - 60 * DAY }),
			attempt({ taskId: "live-1", modelId: "m-new" }),
			attempt({ taskId: "live-2", modelId: "m-new" }),
			attempt({ taskId: "live-3", modelId: "m-new" }),
			attempt({ taskId: "live-4", modelId: "m-old" }),
		];
		const report = assessGoldenSetDrift(events, ["corpus-1"], { now: NOW });
		const model = report.dimensions.find((d) => d.dimension === "model");
		expect(model?.drifted).toBe(true);
		expect(model?.coverage).toBeCloseTo(0.25);
		expect(model?.uncovered[0]).toEqual({ category: "m-new", liveShare: 0.75 });
		expect(report.drifted).toBe(true);
		expect(report.summary).toContain("m-new");
	});

	it("is honest (non-alert) with an empty corpus or an empty live window", () => {
		const empty = assessGoldenSetDrift([attempt({ taskId: "live-1", modelId: "m" })], [], { now: NOW });
		expect(empty.drifted).toBe(false);
		expect(empty.summary).toContain("No corpus cases");
		const stale = assessGoldenSetDrift(
			[attempt({ taskId: "corpus-1", modelId: "m", completedAt: NOW - 90 * DAY })],
			["corpus-1"],
			{ now: NOW },
		);
		expect(stale.drifted).toBe(false);
		expect(stale.summary).toContain("No live attempts");
	});

	it("only excludes live attempts outside the window and treats null difficulty/flow as unknown", () => {
		const events = [
			attempt({ taskId: "corpus-1", modelId: "m", difficulty: "easy", flow: "board", completedAt: NOW - 60 * DAY }),
			attempt({ taskId: "live-1", modelId: "m", difficulty: null, flow: null }),
		];
		const report = assessGoldenSetDrift(events, ["corpus-1"], { now: NOW });
		const difficulty = report.dimensions.find((d) => d.dimension === "difficulty");
		expect(difficulty?.uncovered[0]?.category).toBe("unknown");
	});
});
