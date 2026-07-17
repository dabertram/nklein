import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import { buildCardActionTrail, classifyToolReversibility } from "../../../src/core/card-action-trail";

const AT = 1_800_000_000_000;

function attempt(overrides: {
	taskId: string;
	toolCalls?: { name: string; fingerprint: string | null; outcome: string | null; filePaths?: string[] }[];
	outcome?: string;
	focusStep?: string | null;
	completedAt?: number;
}): AgentLedgerEvent {
	return {
		kind: "attempt",
		schemaVersion: 1,
		eventId: "e1",
		recordedAt: overrides.completedAt ?? AT,
		workflowId: overrides.taskId,
		taskId: overrides.taskId,
		workspacePathHash: "hash",
		modelId: "coder-14b",
		role: "worker",
		promptStrategy: null,
		simplificationLevel: 0,
		contextTokens: null,
		contextBudgetTarget: null,
		difficulty: null,
		flow: null,
		startedAt: (overrides.completedAt ?? AT) - 10_000,
		completedAt: overrides.completedAt ?? AT,
		ttftMs: null,
		tokensPerSec: null,
		toolCalls: overrides.toolCalls ?? [],
		outcome: (overrides.outcome ?? "success") as never,
		qualityScore: null,
		qualityOk: null,
		retriesBefore: 0,
		salvage: null,
		artifacts: null,
		knowledge: null,
		focusStep: overrides.focusStep ?? null,
	} as unknown as AgentLedgerEvent;
}

describe("classifyToolReversibility (F12.55)", () => {
	it("orders the taxonomy by danger: reads, worktree writes, outward actions", () => {
		expect(classifyToolReversibility("read_files")).toBe("read_only");
		expect(classifyToolReversibility("write_files")).toBe("reversible");
		expect(classifyToolReversibility("git_push")).toBe("irreversible");
		expect(classifyToolReversibility("send_email")).toBe("irreversible");
		// Unknown non-destructive names default to reversible, never silently read-only.
		expect(classifyToolReversibility("mystery_tool")).toBe("reversible");
	});
});

describe("buildCardActionTrail (F12.55)", () => {
	it("emits plain-language, file-anchored entries and frames the plan step as a hypothesis", () => {
		const trail = buildCardActionTrail(
			[
				attempt({
					taskId: "t1",
					focusStep: "Add token refresh",
					toolCalls: [
						{ name: "write_files", fingerprint: "f", outcome: "ok", filePaths: ["src/auth.ts"] },
						{ name: "run_commands", fingerprint: "f", outcome: "ok" },
					],
				}),
			],
			"t1",
		);
		const edit = trail.find((entry) => entry.text.startsWith("Edited"));
		expect(edit?.text).toBe("Edited src/auth.ts");
		expect(edit?.files).toEqual(["src/auth.ts"]);
		expect(edit?.reversibility).toBe("reversible");
		expect(edit?.hypothesis).toContain("not evidence");
		expect(trail.at(-1)?.text).toContain("finished cleanly");
	});

	it("collapses quiet read churn into one explored line instead of a dump", () => {
		const trail = buildCardActionTrail(
			[
				attempt({
					taskId: "t1",
					toolCalls: [
						{ name: "read_files", fingerprint: "f", outcome: "ok" },
						{ name: "search_code", fingerprint: "f", outcome: "ok" },
						{ name: "list_dir", fingerprint: "f", outcome: "ok" },
					],
				}),
			],
			"t1",
		);
		expect(trail.filter((entry) => entry.kind === "action")).toHaveLength(1);
		expect(trail[0]?.text).toContain("Explored the workspace (3");
	});

	it("keeps failed calls and other tasks' events honest", () => {
		const trail = buildCardActionTrail(
			[
				attempt({
					taskId: "t1",
					toolCalls: [{ name: "write_files", fingerprint: "f", outcome: "error: EACCES", filePaths: ["a.ts"] }],
				}),
				attempt({ taskId: "OTHER" }),
			],
			"t1",
		);
		expect(trail.some((entry) => entry.text.includes("FAILED (error: EACCES)"))).toBe(true);
		expect(trail.every((entry) => !entry.text.includes("OTHER"))).toBe(true);
	});

	it("renders retrieval events with kept citations as anchors", () => {
		const retrieval = {
			kind: "retrieval",
			schemaVersion: 1,
			eventId: "r1",
			recordedAt: AT,
			workflowId: "t1",
			taskId: "t1",
			workspacePathHash: "hash",
			role: "worker",
			query: "refresh token",
			hitsConsidered: 5,
			distractorsPruned: 2,
			citations: ["src/auth.ts"],
			signal: "unknown",
		} as unknown as AgentLedgerEvent;
		const trail = buildCardActionTrail([retrieval], "t1");
		expect(trail[0]?.text).toContain(
			"`refresh token` — 5 hit(s) considered, 1 citation(s) kept, 2 distractor(s) pruned",
		);
		expect(trail[0]?.files).toEqual(["src/auth.ts"]);
	});
});
