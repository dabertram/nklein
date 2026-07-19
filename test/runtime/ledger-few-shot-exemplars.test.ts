import { describe, expect, it } from "vitest";
import {
	type ExemplarCandidate,
	renderExemplarMessages,
	selectLedgerExemplars,
	textSimilarity,
} from "../../src/core/ledger-few-shot-exemplars";

function candidate(overrides: Partial<ExemplarCandidate> & { attemptId: string; text: string }): ExemplarCandidate {
	return {
		role: "worker",
		succeeded: true,
		toolNames: ["read_files", "edit_file"],
		...overrides,
	};
}

describe("ledger few-shot exemplars (F12.81)", () => {
	it("scores content overlap and ignores stop-words", () => {
		expect(
			textSimilarity("add retry backoff to the fetch layer", "add retry backoff to fetch layer"),
		).toBeGreaterThan(0.8);
		expect(textSimilarity("retry backoff fetch", "rename the css theme tokens")).toBe(0);
		expect(textSimilarity("", "anything")).toBe(0);
	});

	it("selects the most similar successful same-role attempts", () => {
		const selected = selectLedgerExemplars({
			targetText: "add retry with backoff to fetchJson",
			targetRole: "worker",
			candidates: [
				candidate({ attemptId: "a1", text: "add retry with backoff to fetchXml" }),
				candidate({ attemptId: "a2", text: "rename css theme tokens" }),
				candidate({ attemptId: "a3", text: "add retry helper" }),
			],
		});
		expect(selected.map((exemplar) => exemplar.attemptId)).toEqual(["a1", "a3"]);
		expect(selected[0]?.similarity).toBeGreaterThan(selected[1]?.similarity ?? 1);
	});

	it("never offers failures, other roles, or tool-less attempts as examples", () => {
		const selected = selectLedgerExemplars({
			targetText: "add retry with backoff to fetchJson",
			targetRole: "worker",
			candidates: [
				candidate({ attemptId: "failed", text: "add retry with backoff to fetchJson", succeeded: false }),
				candidate({ attemptId: "reviewer", text: "add retry with backoff to fetchJson", role: "reviewer" }),
				candidate({ attemptId: "no-tools", text: "add retry with backoff to fetchJson", toolNames: [] }),
			],
		});
		expect(selected).toEqual([]);
	});

	it("yields NOTHING when no past card is similar (an irrelevant example is worse than none)", () => {
		const selected = selectLedgerExemplars({
			targetText: "add retry with backoff to fetchJson",
			targetRole: "worker",
			candidates: [candidate({ attemptId: "a1", text: "rename css theme tokens" })],
		});
		expect(selected).toEqual([]);
		expect(renderExemplarMessages(selected)).toEqual([]);
	});

	it("caps the selection and breaks ties deterministically", () => {
		const candidates = ["b", "a", "c", "d"].map((id) =>
			candidate({ attemptId: id, text: "add retry with backoff to fetchJson" }),
		);
		const selected = selectLedgerExemplars({
			targetText: "add retry with backoff to fetchJson",
			targetRole: "worker",
			candidates,
			limit: 2,
		});
		// Identical similarity ⇒ attemptId order, so the same prompt is produced every run.
		expect(selected.map((exemplar) => exemplar.attemptId)).toEqual(["a", "b"]);
	});

	it("renders real message turns teaching the SHAPE, not the answer", () => {
		const messages = renderExemplarMessages([
			{ attemptId: "a1", text: "add retry to fetchXml", toolNames: ["read_files", "edit_file"], similarity: 0.7 },
		]);
		expect(messages).toHaveLength(3);
		expect(messages[0]).toEqual({
			role: "user",
			content: "Earlier card that was completed successfully: add retry to fetchXml",
		});
		expect(messages[1]?.role).toBe("assistant");
		expect(messages[1]?.content).toContain("read_files → edit_file");
		expect(messages[2]?.content).toContain("not the answer");
	});
});

import type { AgentLedgerEvent } from "../../src/core/agent-attempt-ledger";
// F12.81 WIRE helper — the ledger↔board join that feeds the pure core.
import { buildExemplarCandidates, buildLedgerExemplarMessages } from "../../src/nklein-agent/ledger-exemplar-messages";

function attempt(overrides: Record<string, unknown>): AgentLedgerEvent {
	return {
		kind: "attempt",
		attemptId: "att-1",
		taskId: "task-old",
		role: "worker",
		outcome: "success",
		toolCalls: [{ name: "read_files", fingerprint: null, outcome: "success" }],
		...overrides,
	} as unknown as AgentLedgerEvent;
}

describe("ledger exemplar wire helper (F12.81)", () => {
	const board = { titleByTaskId: new Map([["task-old", "add retry with backoff to fetchXml"]]) };

	it("joins attempts to card titles and skips the CURRENT card", () => {
		const candidates = buildExemplarCandidates([attempt({})], board, "task-current");
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({ text: "add retry with backoff to fetchXml", succeeded: true });
		// The card being started must never be its own exemplar.
		expect(buildExemplarCandidates([attempt({})], board, "task-old")).toEqual([]);
	});

	it("drops attempts whose card title is unknown and non-attempt events", () => {
		expect(buildExemplarCandidates([attempt({ taskId: "ghost" })], board, "x")).toEqual([]);
		const transition = { kind: "transition", taskId: "task-old" } as unknown as AgentLedgerEvent;
		expect(buildExemplarCandidates([transition], board, "x")).toEqual([]);
	});

	it("produces stamped SDK message turns end-to-end, or nothing when nothing is similar", () => {
		const messages = buildLedgerExemplarMessages({
			events: [attempt({})],
			board,
			taskId: "task-current",
			targetText: "add retry with backoff to fetchJson",
			targetRole: "worker",
			now: 1000,
		});
		expect(messages.length).toBeGreaterThan(0);
		expect(messages[0]).toMatchObject({ id: "kanban-ledger-exemplar-1000-0", role: "user" });
		expect(JSON.stringify(messages[0]?.metadata)).toContain("kanban-ledger-exemplar");

		expect(
			buildLedgerExemplarMessages({
				events: [attempt({})],
				board,
				taskId: "task-current",
				targetText: "rename css theme tokens",
				targetRole: "worker",
				now: 1000,
			}),
		).toEqual([]);
	});
});
