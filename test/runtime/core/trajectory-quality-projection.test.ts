import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	classifyToolAction,
	projectTrajectorySignals,
	summarizeTrajectoryQualityFromLedger,
} from "../../../src/core/trajectory-quality-projection";

describe("classifyToolAction", () => {
	it("classifies edit / validation / read / other by tool name", () => {
		expect(classifyToolAction("write_file")).toBe("edit");
		expect(classifyToolAction("apply_patch")).toBe("edit");
		expect(classifyToolAction("run_command")).toBe("validation");
		expect(classifyToolAction("run_tests")).toBe("validation");
		expect(classifyToolAction("read_files")).toBe("read");
		expect(classifyToolAction("search_code")).toBe("read");
		expect(classifyToolAction("submit_review")).toBe("other");
	});

	it("prioritizes edit over a 'check'-like substring", () => {
		// str_replace_editor contains no 'check', but confirm edit wins when both could match.
		expect(classifyToolAction("edit_and_check")).toBe("edit");
	});
});

describe("projectTrajectorySignals", () => {
	it("derives exact steps-before-first-edit and validation share from the ordered calls", () => {
		const signals = projectTrajectorySignals({
			toolCalls: [{ name: "read_files" }, { name: "search_code" }, { name: "write_file" }, { name: "run_command" }],
			retriesBefore: 1,
			outcome: "success",
		});
		expect(signals.passed).toBe(true);
		expect(signals.totalSteps).toBe(4);
		expect(signals.stepsBeforeFirstEdit).toBe(2); // two reads before the first edit
		expect(signals.retryCount).toBe(1);
		expect(signals.validationEffortShare).toBeCloseTo(0.25, 5); // 1 of 4
	});

	it("proxies opening-patch intensity by edits crammed into the first third", () => {
		// 6 calls, firstThird = 2; both edits are up front → high intensity.
		const signals = projectTrajectorySignals({
			toolCalls: [
				{ name: "write_file" },
				{ name: "edit_file" },
				{ name: "read_files" },
				{ name: "read_files" },
				{ name: "run_command" },
				{ name: "read_files" },
			],
			retriesBefore: 0,
			outcome: "success",
		});
		expect(signals.stepsBeforeFirstEdit).toBe(0); // dove straight in
		expect(signals.openingPatchIntensity).toBe(1); // both edits in the first third
	});

	it("treats a no-edit attempt as all-investigation (stepsBeforeFirstEdit = totalSteps)", () => {
		const signals = projectTrajectorySignals({
			toolCalls: [{ name: "read_files" }, { name: "grep" }],
			retriesBefore: 0,
			outcome: "other_failure",
		});
		expect(signals.passed).toBe(false);
		expect(signals.stepsBeforeFirstEdit).toBe(2);
		expect(signals.openingPatchIntensity).toBe(0);
	});

	it("clamps a negative retriesBefore to 0", () => {
		expect(projectTrajectorySignals({ toolCalls: [], retriesBefore: -3, outcome: "success" }).retryCount).toBe(0);
	});
});

/** Minimal attempt-shaped ledger event (only the fields the projection reads). */
function attemptEvent(modelId: string, toolNames: string[], outcome: string, retriesBefore = 0): AgentLedgerEvent {
	return {
		kind: "attempt",
		modelId,
		outcome,
		retriesBefore,
		toolCalls: toolNames.map((name) => ({ name })),
	} as unknown as AgentLedgerEvent;
}

describe("summarizeTrajectoryQualityFromLedger", () => {
	it("scores every attempt and rolls up overall + per model, ignoring non-attempt events", () => {
		const events: AgentLedgerEvent[] = [
			attemptEvent(
				"m1",
				["read_files", "read_files", "read_files", "read_files", "write_file", "run_command"],
				"success",
			),
			attemptEvent("m1", ["write_file"], "success"), // brittle → likely lucky
			attemptEvent("m2", ["read_files", "write_file"], "other_failure"),
			{ kind: "transition" } as unknown as AgentLedgerEvent, // ignored
		];
		const result = summarizeTrajectoryQualityFromLedger(events);
		expect(result.overall.total).toBe(3);
		expect(result.perModel).toHaveLength(2);
		const m1 = result.perModel.find((p) => p.modelId === "m1");
		expect(m1?.summary.total).toBe(2);
		expect(m1?.summary.passed).toBe(2);
		// per-model sorted by attempt count desc → m1 (2) before m2 (1)
		expect(result.perModel[0]?.modelId).toBe("m1");
		expect(result.scores).toHaveLength(3);
	});

	it("returns an empty rollup for a ledger with no attempts", () => {
		const result = summarizeTrajectoryQualityFromLedger([]);
		expect(result.overall.total).toBe(0);
		expect(result.perModel).toHaveLength(0);
	});
});
