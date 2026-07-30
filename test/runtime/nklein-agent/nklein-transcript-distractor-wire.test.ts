import { describe, expect, it } from "vitest";
import { pruneSupersededToolResults } from "../../../src/nklein-agent/nklein-transcript-distractor-wire";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";

/**
 * P18.3b — the WIRE that makes `pruneTranscriptDistractors` do anything.
 *
 * The pure core skips any message without a `target`, so before this existed nothing was ever pruned: the core had
 * zero production consumers and would have looked installed while changing nothing (`enabled_but_silent`). These
 * tests therefore focus on the two things the wire is actually responsible for — extracting a target from real
 * tool-call arguments, and reclaiming tokens WITHOUT breaking the tool_use/tool_result pairing.
 */

function readCall(id: string, path: string): NKleinSdkPersistedMessage {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name: "read_files", input: { file_path: path } }],
	} as unknown as NKleinSdkPersistedMessage;
}

function readResult(id: string, text: string): NKleinSdkPersistedMessage {
	return {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: id, content: text }],
	} as unknown as NKleinSdkPersistedMessage;
}

function contentBlocks(message: NKleinSdkPersistedMessage): { type: string; content?: unknown }[] {
	return message.content as unknown as { type: string; content?: unknown }[];
}

describe("pruneSupersededToolResults", () => {
	it("prunes an EARLIER read of the same file once a later read supersedes it", () => {
		const messages = [
			readCall("call-1", "src/app.ts"),
			readResult("call-1", "the stale first version of the file ".repeat(40)),
			readCall("call-2", "src/app.ts"),
			readResult("call-2", "the current version of the file ".repeat(40)),
		];

		const outcome = pruneSupersededToolResults(messages);

		expect(outcome, "a re-read of the same path must supersede the earlier one").not.toBeNull();
		expect(outcome?.prunedCount).toBe(1);
		expect(outcome?.tokensFreed ?? 0).toBeGreaterThan(0);
		// The EARLIER result is stubbed; the latest one — the only one still true — is untouched.
		expect(String(contentBlocks(outcome?.messages[1] as NKleinSdkPersistedMessage)[0]?.content)).toContain(
			"superseded tool output removed",
		);
		expect(String(contentBlocks(outcome?.messages[3] as NKleinSdkPersistedMessage)[0]?.content)).toContain(
			"the current version",
		);
	});

	it("STUBS rather than deletes — the tool_use/tool_result pairing survives", () => {
		// The whole safety argument. Dropping a tool_result orphans its tool_use and the provider rejects the entire
		// request with a 400, converting context pressure into a hard failure. Block count, order, types and
		// tool_use_id must all be preserved; only the CONTENT changes.
		const messages = [
			readCall("call-1", "src/app.ts"),
			readResult("call-1", "stale ".repeat(60)),
			readCall("call-2", "src/app.ts"),
			readResult("call-2", "fresh ".repeat(60)),
		];

		const outcome = pruneSupersededToolResults(messages);

		expect(outcome?.messages).toHaveLength(messages.length);
		const stubbed = contentBlocks(outcome?.messages[1] as NKleinSdkPersistedMessage);
		expect(stubbed).toHaveLength(1);
		expect(stubbed[0]?.type).toBe("tool_result");
		expect((stubbed[0] as { tool_use_id?: string }).tool_use_id).toBe("call-1");
	});

	it("leaves a transcript alone when every read targets a DIFFERENT file", () => {
		// Nothing is superseded, so there is nothing to prune. Returning null (not an equal-looking copy) lets the
		// caller keep its array by reference and skip the downstream work entirely.
		const messages = [
			readCall("call-1", "src/a.ts"),
			readResult("call-1", "contents of a"),
			readCall("call-2", "src/b.ts"),
			readResult("call-2", "contents of b"),
		];
		expect(pruneSupersededToolResults(messages)).toBeNull();
	});

	it("returns null when no tool call carries an extractable target", () => {
		// The `enabled_but_silent` condition, pinned: with no target the core cannot prove supersession, and the
		// honest answer is "nothing to do" rather than a guess.
		const messages = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "call-1", name: "think", input: { thought: "hmm" } }],
			} as unknown as NKleinSdkPersistedMessage,
			readResult("call-1", "ok"),
		];
		expect(pruneSupersededToolResults(messages)).toBeNull();
	});

	it("is IDEMPOTENT — a second pass does not re-stub and does not re-count the savings", () => {
		// Overflow can fire repeatedly in one session. Without the marker check, each pass would "free" the stub's
		// own tokens again and report savings that never happened.
		const messages = [
			readCall("call-1", "src/app.ts"),
			readResult("call-1", "stale ".repeat(60)),
			readCall("call-2", "src/app.ts"),
			readResult("call-2", "fresh ".repeat(60)),
		];
		const first = pruneSupersededToolResults(messages);
		expect(first).not.toBeNull();
		expect(pruneSupersededToolResults(first?.messages ?? [])).toBeNull();
	});

	it("ignores multi-file calls, where supersession is not provable from paths alone", () => {
		// A call touching several files has no single stable target. Guessing one would prune output that was never
		// actually replaced — the failure mode is silent and unrecoverable, so the wire declines.
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call-1", name: "read_files", input: { paths: ["src/a.ts", "src/b.ts"] } },
				],
			} as unknown as NKleinSdkPersistedMessage,
			readResult("call-1", "both files"),
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call-2", name: "read_files", input: { paths: ["src/a.ts", "src/b.ts"] } },
				],
			} as unknown as NKleinSdkPersistedMessage,
			readResult("call-2", "both files again"),
		];
		expect(pruneSupersededToolResults(messages)).toBeNull();
	});
});
