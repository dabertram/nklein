import { describe, expect, it } from "vitest";

// The responder is a script, not a module: importing it must not start its queue loop.
process.env.CODEX_RESPONDER_IMPORT_ONLY = "1";
// The script is plain JS with no declarations; the two exports under test are typed here at the boundary.
const responder = (await import(/* @vite-ignore */ "../../scripts/hitl-codex-responder.mjs" as string)) as unknown as {
	parseCodexEvents: (stdout: string) => { text: string; usage: unknown; errors: string[] };
	extractAnswer: (stdout: string) => {
		content: string;
		tool_calls: { name: string; arguments: Record<string, unknown> }[];
		finish_reason: string;
	};
};
const { extractAnswer, parseCodexEvents } = responder;

/** One `codex exec --json` line, as the CLI writes it. */
const event = (value: unknown) => `${JSON.stringify(value)}\n`;

describe("parseCodexEvents", () => {
	it("takes the agent message and the turn's usage out of the event stream", () => {
		const stdout = [
			event({ type: "thread.started", thread_id: "t1" }),
			event({ type: "turn.started" }),
			event({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "hello" } }),
			event({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } }),
		].join("");
		expect(parseCodexEvents(stdout)).toEqual({
			text: "hello",
			usage: { input_tokens: 10, output_tokens: 2 },
			errors: [],
		});
	});

	it("ignores the CLI's own deprecation notice, which says nothing about the turn", () => {
		const stdout = [
			event({
				type: "item.completed",
				item: { type: "error", message: "`[features].codex_hooks` is deprecated. Use …" },
			}),
			event({ type: "item.completed", item: { type: "agent_message", text: "still answered" } }),
		].join("");
		const parsed = parseCodexEvents(stdout);
		expect(parsed.errors).toEqual([]);
		expect(parsed.text).toBe("still answered");
	});

	it("keeps a real error", () => {
		const stdout = event({ type: "item.completed", item: { type: "error", message: "model overloaded" } });
		expect(parseCodexEvents(stdout).errors).toEqual(["model overloaded"]);
	});
});

describe("extractAnswer", () => {
	it("reads the wire object the seat was asked to write", () => {
		const stdout = event({
			type: "item.completed",
			item: { type: "agent_message", text: '{"content":"391","tool_calls":[],"finish_reason":"stop"}' },
		});
		expect(extractAnswer(stdout)).toMatchObject({ content: "391", tool_calls: [], finish_reason: "stop" });
	});

	it("reads tool calls and derives the finish reason from them", () => {
		const stdout = event({
			type: "item.completed",
			item: {
				type: "agent_message",
				text: '{"content":"","tool_calls":[{"name":"read_files","arguments":{"paths":["a.ts"]}}],"finish_reason":"stop"}',
			},
		});
		expect(extractAnswer(stdout)).toMatchObject({
			tool_calls: [{ name: "read_files", arguments: { paths: ["a.ts"] } }],
			finish_reason: "tool_calls",
		});
	});

	it("takes the object out of a code fence, because models add them", () => {
		const stdout = event({
			type: "item.completed",
			item: { type: "agent_message", text: '```json\n{"content":"hi","tool_calls":[],"finish_reason":"stop"}\n```' },
		});
		expect(extractAnswer(stdout).content).toBe("hi");
	});

	it("treats a prose answer as content rather than failing the turn", () => {
		const stdout = event({
			type: "item.completed",
			item: { type: "agent_message", text: "I think the answer is 391." },
		});
		expect(extractAnswer(stdout)).toMatchObject({ content: "I think the answer is 391.", finish_reason: "stop" });
	});

	it("raises a real error when the turn produced no message at all", () => {
		const stdout = event({ type: "item.completed", item: { type: "error", message: "rate limited" } });
		expect(() => extractAnswer(stdout)).toThrow(/rate limited/u);
	});
});
