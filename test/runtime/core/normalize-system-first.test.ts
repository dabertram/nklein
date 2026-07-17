import { describe, expect, it } from "vitest";
import {
	mergeConsecutiveSameRoleMessages,
	mergeConsecutiveSameRoleSdkMessages,
	mergeSystemMessagesFirst,
} from "../../../src/core/normalize-system-first";

const m = (role: string, content: string) => ({ role, content });

describe("mergeSystemMessagesFirst", () => {
	it("no-op (same reference) when already system-first with one system message", () => {
		const msgs = [m("system", "you are helpful"), m("user", "hi")];
		expect(mergeSystemMessagesFirst(msgs)).toBe(msgs);
	});

	it("no-op when there is no system message", () => {
		const msgs = [m("user", "hi"), m("assistant", "hello")];
		expect(mergeSystemMessagesFirst(msgs)).toBe(msgs);
	});

	it("moves a lone system message that appears AFTER a user turn to the front", () => {
		const out = mergeSystemMessagesFirst([m("user", "hi"), m("system", "rules"), m("assistant", "ok")]);
		expect(out.map((x) => x.role)).toEqual(["system", "user", "assistant"]);
		expect(out[0]).toEqual({ role: "system", content: "rules" });
	});

	it("merges MULTIPLE system messages into one leading system message (order preserved)", () => {
		const out = mergeSystemMessagesFirst([
			m("system", "role framing"),
			m("user", "q"),
			m("system", "extra note"),
			m("assistant", "a"),
		]);
		expect(out.map((x) => x.role)).toEqual(["system", "user", "assistant"]);
		expect(out[0]?.content).toBe("role framing\n\nextra note");
	});

	it("preserves the non-system relative order", () => {
		const out = mergeSystemMessagesFirst([m("user", "1"), m("assistant", "2"), m("system", "s"), m("user", "3")]);
		expect(out.map((x) => x.content)).toEqual(["s", "1", "2", "3"]);
	});

	it("skips blank system content when merging but still leads with a system message", () => {
		const out = mergeSystemMessagesFirst([m("user", "hi"), m("system", "   "), m("system", "real")]);
		expect(out[0]).toEqual({ role: "system", content: "real" });
		expect(out.map((x) => x.role)).toEqual(["system", "user"]);
	});

	it("carries through extra fields on the system template message", () => {
		const out = mergeSystemMessagesFirst([
			{ role: "user", content: "hi" },
			{ role: "system", content: "s", name: "sys" } as { role: string; content: string; name: string },
		]);
		expect(out[0]).toMatchObject({ role: "system", content: "s", name: "sys" });
	});
});

describe("mergeConsecutiveSameRoleMessages", () => {
	it("merges adjacent same-role user turns (the ministral strict-alternation 500 case)", () => {
		const merged = mergeConsecutiveSameRoleMessages([
			{ role: "system", content: "sys" },
			{ role: "user", content: "do the task" },
			{ role: "user", content: "nudge: continue" },
		]);
		expect(merged).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "do the task\n\nnudge: continue" },
		]);
	});

	it("merges adjacent assistant turns and collapses runs of three", () => {
		const merged = mergeConsecutiveSameRoleMessages([
			{ role: "user", content: "q" },
			{ role: "assistant", content: "a" },
			{ role: "assistant", content: "b" },
			{ role: "assistant", content: "c" },
		]);
		expect(merged).toEqual([
			{ role: "user", content: "q" },
			{ role: "assistant", content: "a\n\nb\n\nc" },
		]);
	});

	it("returns the SAME array when roles already alternate (common path untouched)", () => {
		const messages = [
			{ role: "system", content: "s" },
			{ role: "user", content: "u" },
			{ role: "assistant", content: "a" },
			{ role: "user", content: "u2" },
		];
		expect(mergeConsecutiveSameRoleMessages(messages)).toBe(messages);
	});

	it("never merges tool-role messages or across a tool boundary (templates allow tool sequences)", () => {
		const messages = [
			{ role: "assistant", content: "calling tool" },
			{ role: "tool", content: "result 1" },
			{ role: "tool", content: "result 2" },
			{ role: "assistant", content: "done" },
		];
		expect(mergeConsecutiveSameRoleMessages(messages)).toBe(messages);
	});

	it("never merges a message carrying extra fields (multimodal parts / tool metadata survive)", () => {
		const withParts = [
			{ role: "user", content: "text", parts: [{ type: "image_url" }] } as unknown as {
				role: string;
				content: string;
			},
			{ role: "user", content: "follow-up" },
		];
		expect(mergeConsecutiveSameRoleMessages(withParts)).toBe(withParts);
	});

	it("skips blank segments when joining", () => {
		const merged = mergeConsecutiveSameRoleMessages([
			{ role: "user", content: "real" },
			{ role: "user", content: "   " },
		]);
		expect(merged).toEqual([{ role: "user", content: "real" }]);
	});
});

describe("mergeConsecutiveSameRoleSdkMessages", () => {
	it("merges a parts-array brief with a plain-string task (the live [system,user,user] 500 case)", () => {
		const merged = mergeConsecutiveSameRoleSdkMessages([
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "[!Klein context focus brief]" }] },
			{ role: "user", content: "Create a breakdown." },
		]);
		expect(merged).toHaveLength(2);
		expect(merged[1]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "[!Klein context focus brief]" },
				{ type: "text", text: "Create a breakdown." },
			],
		});
	});

	it("concatenates two parts arrays and preserves non-text parts (images survive)", () => {
		const merged = mergeConsecutiveSameRoleSdkMessages([
			{ role: "user", content: [{ type: "image_url", image_url: { url: "data:x" } }] },
			{ role: "user", content: [{ type: "text", text: "what is this?" }] },
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.content).toEqual([
			{ type: "image_url", image_url: { url: "data:x" } },
			{ type: "text", text: "what is this?" },
		]);
	});

	it("returns the SAME array when roles already alternate", () => {
		const messages = [
			{ role: "user", content: "u" },
			{ role: "assistant", content: "a" },
		];
		expect(mergeConsecutiveSameRoleSdkMessages(messages)).toBe(messages);
	});

	it("never merges messages carrying tool metadata or tool roles", () => {
		const messages = [
			{ role: "assistant", content: "calling", tool_calls: [{ id: "1" }] } as unknown as {
				role: string;
				content: string;
			},
			{ role: "assistant", content: "again" },
			{ role: "tool", content: "result A" },
			{ role: "tool", content: "result B" },
		];
		expect(mergeConsecutiveSameRoleSdkMessages(messages)).toBe(messages);
	});

	it("merges messages carrying benign identity keys (id/createdAt — the real AgentMessage shape)", () => {
		const merged = mergeConsecutiveSameRoleSdkMessages([
			{ role: "user", content: "brief", id: "m1", createdAt: 1 } as unknown as { role: string; content: string },
			{ role: "user", content: "task", id: "m2", createdAt: 2 } as unknown as { role: string; content: string },
		]);
		expect(merged).toHaveLength(1);
		expect((merged[0] as { id?: string }).id).toBe("m1"); // first message's identity survives
	});

	it("never merges a message whose parts include tool-call/tool-result (provider pairing survives)", () => {
		const messages = [
			{ role: "user", content: [{ type: "tool-result", toolCallId: "1", toolName: "t", output: "ok" }] },
			{ role: "user", content: [{ type: "text", text: "next instruction" }] },
		];
		expect(mergeConsecutiveSameRoleSdkMessages(messages)).toBe(messages);
	});
});
