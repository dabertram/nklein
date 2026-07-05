import { describe, expect, it } from "vitest";
import { type CompactableMessage, planCompaction } from "../../../src/core/context-compaction";
import { judgeRetrievedFreshness } from "../../../src/core/retrieval-freshness";
import { parseSynthesisClaims } from "../../../src/core/retrieval-synthesis-adapter";
import { compactPersistedMessagesForContextOverflow } from "../../../src/nklein-agent/nklein-context-overflow-compaction";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";

// Regression tests for the context/prompt-assembly bug-hunt (2026-07-05).

describe("bug #1 — planCompaction always keeps the most-recent message verbatim (even if it alone exceeds the budget)", () => {
	it("does not drop/summarize a final tool_result larger than keepRecentTokens", () => {
		const messages: CompactableMessage[] = [
			{ role: "user", tokens: 100 },
			{ role: "assistant", tokens: 100 },
			{ role: "tool", tokens: 5_000 }, // the live tool result the model must act on next
		];
		const plan = planCompaction({ messages, keepRecentTokens: 4_000 });
		expect(plan.keepVerbatim).toContain(2); // the last message survives verbatim
		expect(plan.drop).not.toContain(2);
		expect(plan.summarize).not.toContain(2);
	});
});

describe("bug #2 — the overflow fallback never cuts onto an orphaned tool_result (turn-start boundary)", () => {
	const m = (role: "user" | "assistant", content: unknown): NKleinSdkPersistedMessage =>
		({ role, content }) as unknown as NKleinSdkPersistedMessage;

	it("returns null (no unsafe cut) rather than a leading tool_result whose tool_use was dropped", () => {
		const transcript = [
			m("user", "the task"),
			m("assistant", [{ type: "tool_use", id: "A", name: "read", input: {} }]),
			m("user", [{ type: "tool_result", tool_use_id: "A", content: "ok" }]),
			m("assistant", [{ type: "tool_use", id: "B", name: "read", input: {} }]),
			m("user", [{ type: "tool_result", tool_use_id: "B", content: "ok" }]),
			m("assistant", "done"),
		];
		const result = compactPersistedMessagesForContextOverflow(transcript);
		if (result) {
			const first = result[0];
			const orphan =
				first.role === "user" &&
				Array.isArray(first.content) &&
				first.content.length > 0 &&
				first.content.every((block: { type: string }) => block.type === "tool_result");
			expect(orphan).toBe(false);
		} else {
			expect(result).toBeNull(); // the safe outcome when no clean turn-start exists to cut on
		}
	});
});

describe("bug #3 — judgeRetrievedFreshness compares fractional age (sub-day sources are not all 'current')", () => {
	const now = new Date("2026-07-05T12:00:00Z");
	const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

	it("an 11h-old source is NOT 'current' under a realtime band (current threshold 0)", () => {
		const j = judgeRetrievedFreshness({ publishedAt: hoursAgo(11) }, now, {
			thresholds: { current: 0, recent: 1, possiblyStale: 3 },
		});
		expect(j.verdict).not.toBe("current");
		expect(j.verdict).toBe("recent"); // ~0.46 days ≤ recent(1)
	});
});

describe("bug #4 — parseSynthesisClaims extracts the JSON array past prose brackets", () => {
	const known = new Set(["e2"]);

	it("recovers claims when a markdown [link] precedes a ```json array", () => {
		const raw = 'Here you go:\n- see [docs]\n```json\n[{"claim":"X","cite":["e2"]}]\n```';
		expect(parseSynthesisClaims(raw, known)).toEqual([{ text: "X", citedEvidenceIds: ["e2"] }]);
	});
});
