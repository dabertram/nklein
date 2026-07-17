import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import { mineGoldenSetCandidates } from "../../../src/core/golden-set-miner";

function attempt(taskId: string, outcome: string, toolNames: string[] = ["read_files"], retries = 0): AgentLedgerEvent {
	return {
		kind: "attempt",
		taskId,
		modelId: "m",
		outcome,
		retriesBefore: retries,
		toolCalls: toolNames.map((name) => ({ name })),
	} as unknown as AgentLedgerEvent;
}

describe("mineGoldenSetCandidates", () => {
	it("selects failures and F12.42-lucky wins, skipping disciplined passes", () => {
		const disciplinedPass = attempt("t-good", "success", [
			"read_files",
			"read_files",
			"read_files",
			"read_files",
			"read_files",
			"write_file",
			"run_command",
		]);
		const luckyPass = attempt("t-lucky", "success", ["write_file"], 4); // dove in, thrashed — lucky
		const failure = attempt("t-fail", "timeout");
		const candidates = mineGoldenSetCandidates([disciplinedPass, luckyPass, failure]);
		expect(candidates.map((candidate) => `${candidate.kind}:${candidate.taskId}`)).toEqual([
			"failure:t-fail",
			"lucky_win:t-lucky",
		]);
	});

	it("dedupes per task with failure outranking a lucky win", () => {
		const candidates = mineGoldenSetCandidates([
			attempt("t1", "success", ["write_file"], 4), // lucky
			attempt("t1", "other_failure"), // same task later fails
		]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({ taskId: "t1", kind: "failure" });
	});

	it("keeps the failure slot even when a lucky win comes AFTER the failure", () => {
		const candidates = mineGoldenSetCandidates([
			attempt("t1", "timeout"),
			attempt("t1", "success", ["write_file"], 4),
		]);
		expect(candidates[0]).toMatchObject({ taskId: "t1", kind: "failure" });
	});

	it("caps the candidate list", () => {
		const events = Array.from({ length: 10 }, (_, i) => attempt(`t${i}`, "timeout"));
		expect(mineGoldenSetCandidates(events, { limit: 3 })).toHaveLength(3);
	});
});
