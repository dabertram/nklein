import { describe, expect, it } from "vitest";
import {
	compactKanbanMessagesForContextTarget,
	isCompactionPinnedMessage,
} from "../../../src/nklein-agent/nklein-context-focus-policy";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";

/**
 * F4.46 retention contract + provenance continuity: a message stamped `metadata.compactionPinned` must survive
 * compaction BYTE-INTACT — including the emergency rebuild — so a cited `file:line` provenance fact is never
 * summarized away. Unpinned filler of the same shape compacts as before (the contract must not disable compaction).
 */
describe("compaction pinned retention (F4.46)", () => {
	const CITATION = `Evidence: the retry cap is set in src/core/retry-ladder.ts:142 (maxAttempts = 3). ${"context ".repeat(60)}`;

	function buildMessages(): NKleinSdkPersistedMessage[] {
		const filler = (id: string): NKleinSdkPersistedMessage =>
			({
				id,
				role: "assistant",
				content: `${id} filler analysis. ${"padding tokens here ".repeat(400)}`,
			}) as NKleinSdkPersistedMessage;
		return [
			{ id: "m0", role: "user", content: "Fix the retry cap bug." } as NKleinSdkPersistedMessage,
			filler("m1"),
			{
				id: "m2",
				role: "user",
				content: CITATION,
				metadata: { compactionPinned: true },
			} as NKleinSdkPersistedMessage,
			filler("m3"),
			filler("m4"),
			{ id: "m5", role: "user", content: "Continue." } as NKleinSdkPersistedMessage,
		];
	}

	it("detects the pin marker and nothing else", () => {
		const messages = buildMessages();
		expect(messages.filter(isCompactionPinnedMessage).map((message) => message.id)).toEqual(["m2"]);
	});

	it("keeps the pinned citation byte-intact through normal compaction while filler compacts", () => {
		const compacted = compactKanbanMessagesForContextTarget(buildMessages(), 800);
		expect(compacted).not.toBeNull();
		const pinned = compacted?.find((message) => message.id === "m2");
		expect(pinned?.content).toBe(CITATION);
		const fillerContent = compacted?.find((message) => message.id === "m1")?.content;
		expect(typeof fillerContent).toBe("string");
		expect(typeof fillerContent === "string" ? fillerContent.length : Number.NaN).toBeLessThan(1_000);
	});

	it("carries the pinned citation verbatim through the emergency rebuild", () => {
		const compacted = compactKanbanMessagesForContextTarget(buildMessages(), 40);
		expect(compacted).not.toBeNull();
		const texts = (compacted ?? []).map((message) => (typeof message.content === "string" ? message.content : ""));
		expect(texts.some((text) => text === CITATION)).toBe(true);
		expect(texts.some((text) => text.includes("src/core/retry-ladder.ts:142"))).toBe(true);
	});
});
