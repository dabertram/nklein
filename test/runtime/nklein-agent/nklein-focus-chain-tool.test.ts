import { describe, expect, it } from "vitest";
import type { FocusChain } from "../../../src/core/focus-chain";
import { createNKleinFocusChainTool } from "../../../src/nklein-agent/nklein-focus-chain-tool";

async function run(input: unknown): Promise<{ chain: FocusChain | null; output: unknown }> {
	let captured: FocusChain | null = null;
	const tool = createNKleinFocusChainTool({
		onUpdated: (chain) => {
			captured = chain;
		},
	});
	const output = await tool.execute(input, undefined as never);
	return { chain: captured, output };
}

describe("update_focus_chain tool", () => {
	it("records a normalized chain and fires the callback", async () => {
		const { chain, output } = await run({
			steps: [
				{ text: "Read the spec", status: "done" },
				{ text: "Implement the parser", status: "in_progress" },
				{ text: "Add tests", status: "pending" },
			],
		});
		expect(chain?.steps).toEqual([
			{ text: "Read the spec", status: "done" },
			{ text: "Implement the parser", status: "in_progress" },
			{ text: "Add tests", status: "pending" },
		]);
		expect(output).toMatchObject({ ok: true, total: 3, done: 1 });
	});

	it("defaults a step's status to pending", async () => {
		const { chain } = await run({ steps: [{ text: "Do the thing" }] });
		expect(chain?.steps[0]).toEqual({ text: "Do the thing", status: "pending" });
	});

	it("rejects an empty chain without firing the callback", async () => {
		const { chain, output } = await run({ steps: [{ text: "   ", status: "pending" }] });
		expect(chain).toBeNull();
		expect(output).toMatchObject({ ok: false });
	});

	it("run31 regression: accepts `name` as an alias for `text` instead of pre-rejecting the call", async () => {
		// gpt-oss-120b sent {"steps":[{"name":"Create task list","status":"in_progress"}]} live; the strict
		// schema rejected it before execution and the architect turn derailed into a text-only stop.
		const { chain, output } = await run({ steps: [{ name: "Create task list", status: "in_progress" }] });
		expect(chain?.steps).toEqual([{ text: "Create task list", status: "in_progress" }]);
		expect(output).toMatchObject({ ok: true, total: 1 });
	});

	it("normalizes common status synonyms (completed/in-progress/todo)", async () => {
		const { chain } = await run({
			steps: [
				{ text: "a", status: "completed" },
				{ title: "b", status: "in-progress" },
				{ text: "c", status: "todo" },
			],
		});
		expect(chain?.steps).toEqual([
			{ text: "a", status: "done" },
			{ text: "b", status: "in_progress" },
			{ text: "c", status: "pending" },
		]);
	});

	it("returns a corrective instruction (not a throw) when steps are unreadable", async () => {
		const { chain, output } = await run({ steps: [{ status: "pending" }] });
		expect(chain).toBeNull();
		expect(output).toMatchObject({ ok: false });
		expect((output as { instruction: string }).instruction).toContain('"text"');
	});

	it("#27-style: tolerates a model echoing the tool name at the top level", async () => {
		const { output } = await run({ name: "update_focus_chain", steps: [{ text: "a", status: "pending" }] });
		expect(output).toMatchObject({ ok: true, total: 1 });
	});

	it("reports completion when every step is done or skipped", async () => {
		const { output } = await run({
			steps: [
				{ text: "a", status: "done" },
				{ text: "b", status: "skipped" },
			],
		});
		expect(output).toMatchObject({ ok: true });
		expect((output as { instruction: string }).instruction).toContain("done or skipped");
	});
});
