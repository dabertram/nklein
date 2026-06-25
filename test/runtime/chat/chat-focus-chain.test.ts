import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
