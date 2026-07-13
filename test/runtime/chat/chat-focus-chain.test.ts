import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyOperatorChatFocusChainUpdate,
	createFocusChainTools,
	type FocusChainToolDeps,
	readChatFocusChain,
	writeChatFocusChain,
} from "../../../src/chat/chat-focus-chain";
import type { FocusChain } from "../../../src/core/focus-chain";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "kanban-focus-chain-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("chat focus-chain store", () => {
	it("returns null when no chain is stored, round-trips a written one, and isolates sessions", async () => {
		expect(await readChatFocusChain("s1", { rootDir: root })).toBeNull();
		const chain: FocusChain = { steps: [{ text: "do x", status: "pending" }], updatedAt: 1 };
		await writeChatFocusChain("s1", chain, { rootDir: root });
		const read = await readChatFocusChain("s1", { rootDir: root });
		expect(read?.steps).toHaveLength(1);
		expect(read?.steps[0]?.text).toBe("do x");
		// A different session has its own (absent) chain.
		expect(await readChatFocusChain("s2", { rootDir: root })).toBeNull();
	});
});

describe("createFocusChainTools — update_focus_chain", () => {
	function makeTool(store: { value: FocusChain | null }) {
		const deps: FocusChainToolDeps = {
			read: async () => store.value,
			write: async (_sessionId, chain) => {
				store.value = chain;
			},
		};
		const { tools } = createFocusChainTools("sess", { deps, now: () => 1000 });
		const tool = tools.find((candidate) => candidate.name === "update_focus_chain");
		if (!tool) {
			throw new Error("update_focus_chain tool missing");
		}
		return tool;
	}

	it("is a sandbox_read action (a benign internal note — always allowed by the gate)", () => {
		expect(createFocusChainTools("s").tools[0]?.actionKind).toBe("sandbox_read");
	});

	it("normalizes + persists the re-emitted chain and reports progress", async () => {
		const store = { value: null as FocusChain | null };
		const out = await makeTool(store).run({
			steps: [
				{ text: "a", status: "done" },
				{ text: "b", status: "in_progress" },
			],
		});
		expect(store.value?.steps).toHaveLength(2);
		expect(out).toContain("1/2 done");
		expect(out).toContain("1 in progress");
	});

	it("rejects empty/invalid steps without persisting", async () => {
		const store = { value: null as FocusChain | null };
		const out = await makeTool(store).run({ steps: [] });
		expect(out).toMatch(/Provide `steps`/);
		expect(store.value).toBeNull();
	});

	it("carries per-step timing across a re-emission (started stays; completed stamped)", async () => {
		const store = { value: null as FocusChain | null };
		const tool = makeTool(store);
		await tool.run({ steps: [{ text: "a", status: "in_progress" }] });
		expect(store.value?.steps[0]?.startedAt).toBe(1000);
		await tool.run({ steps: [{ text: "a", status: "done" }] });
		expect(store.value?.steps[0]?.startedAt).toBe(1000);
		expect(store.value?.steps[0]?.completedAt).toBe(1000);
	});
});

describe("applyOperatorChatFocusChainUpdate (F1.6 operator edits)", () => {
	it("accepts a valid edit, carries per-step timing from the prior chain, and persists it", async () => {
		await applyOperatorChatFocusChainUpdate("op-1", [{ text: "a", status: "in_progress" }], {
			rootDir: root,
			now: () => 1_000,
		});
		const result = await applyOperatorChatFocusChainUpdate(
			"op-1",
			[
				{ text: "a", status: "done" },
				{ text: "b", status: "pending" },
			],
			{ rootDir: root, now: () => 2_000 },
		);
		expect(result.ok).toBe(true);
		expect(result.rejected).toBeNull();
		expect(result.chain?.steps.map((step) => step.status)).toEqual(["done", "pending"]);
		expect(result.chain?.steps[0]?.startedAt).toBe(1_000); // carried from the prior in_progress emission
		expect(result.chain?.steps[0]?.completedAt).toBe(2_000);
		expect((await readChatFocusChain("op-1", { rootDir: root }))?.steps).toHaveLength(2);
	});

	it("treats an empty steps list as a deliberate operator clear", async () => {
		await applyOperatorChatFocusChainUpdate("op-2", [{ text: "a", status: "done" }], { rootDir: root });
		const cleared = await applyOperatorChatFocusChainUpdate("op-2", [], { rootDir: root });
		expect(cleared).toEqual({ ok: true, rejected: null, chain: null });
		expect(await readChatFocusChain("op-2", { rootDir: root })).toBeNull();
	});

	it("rejects invalid steps and keeps the stored chain", async () => {
		await applyOperatorChatFocusChainUpdate("op-3", [{ text: "keep me", status: "done" }], { rootDir: root });
		const result = await applyOperatorChatFocusChainUpdate("op-3", [{ text: "", status: "nonsense" }], {
			rootDir: root,
		});
		expect(result.ok).toBe(false);
		expect(result.rejected).toBe("No valid steps were provided.");
		expect(result.chain?.steps[0]?.text).toBe("keep me");
		expect((await readChatFocusChain("op-3", { rootDir: root }))?.steps[0]?.text).toBe("keep me");
	});

	it("rejects a progress-destroying rewrite with the guard's reason and keeps the stored chain", async () => {
		await applyOperatorChatFocusChainUpdate("op-4", [{ text: "Read the spec", status: "done" }], { rootDir: root });
		const result = await applyOperatorChatFocusChainUpdate("op-4", [{ text: "Brand new plan", status: "pending" }], {
			rootDir: root,
		});
		expect(result.ok).toBe(false);
		expect(result.rejected).toBeTruthy();
		expect(result.chain?.steps[0]?.text).toBe("Read the spec");
		expect((await readChatFocusChain("op-4", { rootDir: root }))?.steps[0]?.text).toBe("Read the spec");
	});
});

describe("chat focus chain repair guard (F1.5)", () => {
	it("rejects a destructive re-emit with an explanatory tool result and keeps the stored chain", async () => {
		const stored = new Map<string, FocusChain>();
		const tools = createFocusChainTools("session-guard", {
			deps: {
				read: async (id) => stored.get(id) ?? null,
				write: async (id, chain) => void stored.set(id, chain),
			},
			now: () => 1_000,
		});
		const update = tools.tools.find((tool) => tool.name === "update_focus_chain");
		if (!update) {
			throw new Error("update_focus_chain tool missing");
		}
		await update.run({ steps: [{ text: "Read the spec", status: "done" }] });
		const rejection = await update.run({ steps: [{ text: "Brand new plan", status: "pending" }] });
		expect(String(rejection)).toMatch(/rejected/i);
		expect(stored.get("session-guard")?.steps[0]?.text).toBe("Read the spec");
	});
});
