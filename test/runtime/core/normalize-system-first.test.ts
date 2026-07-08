import { describe, expect, it } from "vitest";
import { mergeSystemMessagesFirst } from "../../../src/core/normalize-system-first";

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
