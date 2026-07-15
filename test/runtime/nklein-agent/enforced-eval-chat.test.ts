import { describe, expect, it, vi } from "vitest";
import { buildEnforcedEvalChat } from "../../../src/nklein-agent/enforced-eval-chat";
import type { ModelEvalChat } from "../../../src/nklein-agent/model-eval-runner";

describe("buildEnforcedEvalChat", () => {
	it("drafts via the base chat, refines through the injected enforce, and returns the enhanced answer", async () => {
		const base: ModelEvalChat = async () => ({ message: { content: "raw draft" } });
		const enforce = vi.fn(async (input: { task: string; draft: string }) => `ENHANCED(${input.draft})`);
		const chat = buildEnforcedEvalChat(base, "coder-test", enforce as never);

		const choice = await chat([{ role: "user", content: "solve X" }], {});

		expect(enforce).toHaveBeenCalledOnce();
		const call = enforce.mock.calls[0]?.[0] as { task: string; draft: string; enabled?: boolean; modelId?: string };
		expect(call.task).toBe("solve X");
		expect(call.draft).toBe("raw draft");
		expect(call.enabled).toBe(true);
		expect(call.modelId).toBe("coder-test");
		expect(choice?.message?.content).toBe("ENHANCED(raw draft)");
	});

	it("passes an empty/absent draft straight through without invoking enforce", async () => {
		const emptyBase: ModelEvalChat = async () => ({ message: { content: "   " } });
		const nullBase: ModelEvalChat = async () => null;
		const enforce = vi.fn(async () => "should not run");

		expect(
			(await buildEnforcedEvalChat(emptyBase, "m", enforce as never)([{ role: "user", content: "q" }], {}))?.message
				?.content,
		).toBe("   ");
		expect(
			await buildEnforcedEvalChat(nullBase, "m", enforce as never)([{ role: "user", content: "q" }], {}),
		).toBeNull();
		expect(enforce).not.toHaveBeenCalled();
	});

	it("its `complete` re-invokes the base chat (the same-model reasoning completer)", async () => {
		const base = vi.fn<ModelEvalChat>(async () => ({ message: { content: "draft" } }));
		let completerResult: string | null = null;
		const enforce = vi.fn(async (input: { complete: (i: { system?: string; user: string }) => Promise<string> }) => {
			completerResult = await input.complete({ user: "reflect" });
			return "done";
		});
		await buildEnforcedEvalChat(base, "m", enforce as never)([{ role: "user", content: "q" }], {});
		// The completer reads the base chat's answer text; base is called for the draft AND the completer.
		expect(completerResult).toBe("draft");
		expect(base).toHaveBeenCalledTimes(2);
	});
});
