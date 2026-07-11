import { describe, expect, it } from "vitest";
import { type BoardChatDigestItem, buildBoardChatDigest } from "../../../src/core/board-chat-digest";

const item = (over: Partial<BoardChatDigestItem> & { title: string }): BoardChatDigestItem => ({
	taskId: `t-${over.title}`,
	tier: "notify",
	reason: "done",
	...over,
});

describe("buildBoardChatDigest — single item (plain one-liner, no ceremony)", () => {
	it("renders a done card with its result snippet", () => {
		const d = buildBoardChatDigest({ items: [item({ title: "auth", reason: "done", resultText: "build passes" })] });
		expect(d.message).toBe('✅ "auth" ready for review: build passes');
		expect(d.itemCount).toBe(1);
		expect(d.truncated).toBe(false);
	});

	it("renders an ASK card with its decision verbs", () => {
		const d = buildBoardChatDigest({
			items: [item({ title: "migrate", tier: "ask", reason: "needs_input", suggestedVerbs: ["respond"] })],
		});
		expect(d.message).toBe('⚠️ "migrate" needs you — needs_input (respond)');
		expect(d.askCount).toBe(1);
	});

	it("renders a failed card and a heartbeat-lost card", () => {
		expect(
			buildBoardChatDigest({ items: [item({ title: "x", reason: "failed", resultText: "npm test exit 1" })] })
				.message,
		).toBe('❌ "x" failed: npm test exit 1');
		expect(buildBoardChatDigest({ items: [item({ title: "y", reason: "heartbeat_lost" })] }).message).toContain(
			"heartbeat lost",
		);
	});

	it("collapses multi-line result text to a single capped snippet", () => {
		const long = `line one\nline two ${"z".repeat(200)}`;
		const d = buildBoardChatDigest({ items: [item({ title: "big", reason: "done", resultText: long })] });
		expect(d.message).not.toContain("\n");
		expect(d.message.endsWith("…")).toBe(true);
	});
});

describe("buildBoardChatDigest — multi-item rollup", () => {
	const many: BoardChatDigestItem[] = [
		item({ title: "b", reason: "failed" }),
		item({ title: "a", tier: "ask", reason: "delivery_gate_held", suggestedVerbs: ["approve", "reject"] }),
		item({ title: "c", tier: "milestone", reason: "decomposition phase boundary" }),
	];

	it("orders ASK first, then NOTIFY, then MILESTONE", () => {
		const d = buildBoardChatDigest({ items: many });
		const lines = d.message.split("\n");
		expect(lines[0]).toBe("Board update:");
		expect(lines[1]).toContain('"a" needs you'); // ask
		expect(lines[2]).toContain('"b" failed'); // notify
		expect(lines[3]).toContain('"c"'); // milestone
		expect(d.askCount).toBe(1);
	});

	it("renders a milestone as plain plan-progress from its counts (no 'decomposition phase boundary' jargon)", () => {
		const partial = buildBoardChatDigest({
			items: [
				item({
					title: "c",
					tier: "milestone",
					reason: "decomposition phase boundary",
					milestone: { done: 3, total: 8 },
				}),
			],
		});
		expect(partial.message).toContain('▸ "c" — 3 of 8 planned steps done');
		expect(partial.message).not.toContain("decomposition phase boundary");

		const complete = buildBoardChatDigest({
			items: [
				item({
					title: "c",
					tier: "milestone",
					reason: "decomposition phase boundary",
					milestone: { done: 8, total: 8 },
				}),
			],
		});
		expect(complete.message).toContain('▸ "c" — all 8 planned steps done');
	});

	it("heads the rollup with a stream/group label when given (§5.AU forward-compat)", () => {
		const d = buildBoardChatDigest({ items: many, groupLabel: "Auth stream" });
		expect(d.message.split("\n")[0]).toBe("Auth stream — board update:");
	});

	it("caps card-lines and appends a '+M more' pointer", () => {
		const items = Array.from({ length: 8 }, (_, i) => item({ title: `card${i}`, reason: "done" }));
		const d = buildBoardChatDigest({ items, cardLineCap: 3 });
		expect(d.truncated).toBe(true);
		expect(d.itemCount).toBe(8);
		expect(d.message).toContain("+5 more — open the board.");
		// header + 3 lines + the "+more" line = 5 lines.
		expect(d.message.split("\n")).toHaveLength(5);
	});
});

describe("buildBoardChatDigest — health rollup (pull / get_board_status path)", () => {
	it("renders only the non-zero operator-relevant buckets when there are no items", () => {
		const d = buildBoardChatDigest({ items: [], boardHealth: { healthy: 3, stuck: 0, risky: 1, done: 2 } });
		expect(d.message).toBe("Board: 1 needs you · 3 on track · 2 done.");
		expect(d.itemCount).toBe(0);
	});

	it("returns an empty message when there is genuinely nothing to say", () => {
		expect(buildBoardChatDigest({ items: [] }).message).toBe("");
	});

	it("appends the health line under a multi-item rollup", () => {
		const d = buildBoardChatDigest({
			items: [item({ title: "a", reason: "done" }), item({ title: "b", reason: "failed" })],
			boardHealth: { healthy: 1, stuck: 0, risky: 0, done: 4 },
		});
		expect(d.message.split("\n").at(-1)).toBe("Board: 1 on track · 4 done.");
	});
});
