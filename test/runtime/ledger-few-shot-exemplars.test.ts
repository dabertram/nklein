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
