import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	buildSessionSystemPrompt: vi.fn((_i: unknown) => ({ text: "PROMPT", headPinnedVolatileKeys: ["custom_base"] })),
	buildPromptShellKey: vi.fn((_i: unknown) => "shell-key"),
	computeSharedPrefixRatio: vi.fn((_a: string, _b: string) => 0.5),
	recordSelfObservation: vi.fn(),
	now: vi.fn(() => 1_000),
}));

vi.mock("../../../src/nklein-agent/nklein-session-system-prompt", () => ({
	buildSessionSystemPrompt: h.buildSessionSystemPrompt,
}));
vi.mock("../../../src/core/cache-warmth", () => ({ buildPromptShellKey: h.buildPromptShellKey }));
vi.mock("../../../src/core/prompt-fragment-assembly", () => ({ computeSharedPrefixRatio: h.computeSharedPrefixRatio }));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: h.recordSelfObservation }));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({ now: h.now }));

import { createPromptWarmthLedger } from "../../../src/nklein-agent/nklein-prompt-warmth-ledger";

const input = (over: Record<string, unknown> = {}) =>
	({
		taskId: "t1",
		modelId: "lmstudio/m",
		sessionKind: "worker",
		workspacePath: "/ws",
		basePrompt: "base",
		baseIsStaticShell: true,
		efficiencyRules: "",
		temporalBlock: "",
		...over,
	}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	h.buildSessionSystemPrompt.mockReturnValue({ text: "PROMPT", headPinnedVolatileKeys: ["custom_base"] });
});

describe("createPromptWarmthLedger", () => {
	it("returns the assembled text and records the shell key on the FIRST assembly (no reuse observation)", () => {
		const ledger = createPromptWarmthLedger();
		const out = ledger.assembleAndRecord(input());
		expect(out).toBe("PROMPT");
		expect(ledger.shellKeyByModelId.get("lmstudio/m")).toEqual({ shellKey: "shell-key", at: 1_000 });
		expect(h.recordSelfObservation).not.toHaveBeenCalled(); // no previous prompt to compare against
	});

	it("records a partial-reuse observation on a second, DIFFERENT assembly for the same model", () => {
		const ledger = createPromptWarmthLedger();
		ledger.assembleAndRecord(input());
		h.buildSessionSystemPrompt.mockReturnValue({ text: "PROMPT-v2", headPinnedVolatileKeys: [] });
		ledger.assembleAndRecord(input());
		expect(h.computeSharedPrefixRatio).toHaveBeenCalledWith("PROMPT", "PROMPT-v2");
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ category: "prompt_prefix_reuse", identical: false, reuseRatio: 0.5 }),
			}),
		);
	});

	it("records identical=true / reuseRatio=1 on a byte-identical reassembly (perfect prefix-cache hit)", () => {
		const ledger = createPromptWarmthLedger();
		ledger.assembleAndRecord(input());
		ledger.assembleAndRecord(input()); // same "PROMPT" text
		expect(h.computeSharedPrefixRatio).not.toHaveBeenCalled(); // short-circuited for identical
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ identical: true, reuseRatio: 1 }) }),
		);
	});

	it("normalizes a missing model id to the (unconfigured) key", () => {
		const ledger = createPromptWarmthLedger();
		ledger.assembleAndRecord(input({ modelId: null }));
		expect(ledger.shellKeyByModelId.has("(unconfigured)")).toBe(true);
	});
});
