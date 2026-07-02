import { describe, expect, it } from "vitest";
import {
	applyWarmthPreference,
	buildPromptShellKey,
	classifyShellWarmth,
	DEFAULT_WARMTH_STALE_AFTER_MS,
	derivePromptSessionKind,
	type PromptWarmthLedgerEntry,
} from "../../../src/core/cache-warmth";
import { applyDiversityPreference } from "../../../src/core/model-diversity";

const NOW = 1_000_000;

const candidate = (modelKey: string, score: number) => ({ modelKey, modelId: modelKey, score });

const ledger = (entries: Record<string, { shellKey: string; at?: number }>): Map<string, PromptWarmthLedgerEntry> =>
	new Map(
		Object.entries(entries).map(([modelId, entry]) => [modelId, { shellKey: entry.shellKey, at: entry.at ?? NOW }]),
	);

const shell = (sessionKind: Parameters<typeof buildPromptShellKey>[0]["sessionKind"], modelId: string) =>
	buildPromptShellKey({ sessionKind, workspacePath: "/repo/a", modelId });

describe("buildPromptShellKey (§5.AQ prompt-shell identity)", () => {
	it("is stable for identical inputs and distinct across kind / workspace / model", () => {
		const base = { sessionKind: "worker" as const, workspacePath: "/repo/a", modelId: "qwen3.5-9b" };
		expect(buildPromptShellKey(base)).toBe(buildPromptShellKey({ ...base }));
		expect(buildPromptShellKey({ ...base, sessionKind: "review" })).not.toBe(buildPromptShellKey(base));
		expect(buildPromptShellKey({ ...base, workspacePath: "/repo/b" })).not.toBe(buildPromptShellKey(base));
		expect(buildPromptShellKey({ ...base, modelId: "gpt-oss-20b" })).not.toBe(buildPromptShellKey(base));
	});

	it("cannot collide across part boundaries (NUL separator — paths/ids never contain NUL)", () => {
		expect(buildPromptShellKey({ sessionKind: "worker", workspacePath: "/a b", modelId: "c" })).not.toBe(
			buildPromptShellKey({ sessionKind: "worker", workspacePath: "/a", modelId: "b c" }),
		);
	});
});

describe("derivePromptSessionKind", () => {
	it("derives synthetic kinds from the :: task-id suffix", () => {
		expect(derivePromptSessionKind("task-1::review")).toBe("review");
		expect(derivePromptSessionKind("task-1::plan-critique")).toBe("plan-critique");
		expect(derivePromptSessionKind("task-1::merge")).toBe("merge");
	});

	it("maps home-agent session ids to chat", () => {
		expect(derivePromptSessionKind("__home_agent__:ws-1:nklein")).toBe("chat");
	});

	it("card sessions are architect only for explicit decompositions, else worker", () => {
		expect(derivePromptSessionKind("task-1", { isExplicitDecomposition: true })).toBe("architect");
		expect(derivePromptSessionKind("task-1")).toBe("worker");
	});

	it("unknown :: suffixes fall through to worker (documented approximation — e.g. ::acceptance)", () => {
		expect(derivePromptSessionKind("task-1::acceptance")).toBe("worker");
	});
});

describe("classifyShellWarmth (partial-warmth tiers)", () => {
	const prospective = { sessionKind: "review" as const, workspacePath: "/repo/a", modelId: "m1" };

	it("same kind + workspace + model = hot", () => {
		expect(classifyShellWarmth(shell("review", "m1"), prospective)).toBe("hot");
	});

	it("same workspace + model, different kind = warm", () => {
		expect(classifyShellWarmth(shell("worker", "m1"), prospective)).toBe("warm");
	});

	it("different workspace or model = cold", () => {
		expect(
			classifyShellWarmth(
				buildPromptShellKey({ sessionKind: "review", workspacePath: "/repo/b", modelId: "m1" }),
				prospective,
			),
		).toBe("cold");
		expect(classifyShellWarmth(shell("review", "m2"), prospective)).toBe("cold");
	});
});

describe("applyWarmthPreference (margin-bounded tiebreaker, mirrors applyDiversityPreference)", () => {
	const base = {
		sessionKind: "worker" as const,
		workspacePath: "/repo/a",
		now: NOW,
	};

	it("promotes a HOT candidate over a colder higher-scored one within the margin", () => {
		const result = applyWarmthPreference({
			...base,
			ranked: [candidate("cold-model", 80), candidate("hot-model", 72)],
			lastShellKeyByModel: ledger({ "hot-model": { shellKey: shell("worker", "hot-model") } }),
		});
		expect(result.ranked.map((entry) => entry.modelKey)).toEqual(["hot-model", "cold-model"]);
		expect(result.warmthApplied).toBe(true);
		expect(result.warmthReason).toContain("HOT");
	});

	it("NEVER promotes past the margin — warmth is a tiebreaker, not a correctness override", () => {
		const result = applyWarmthPreference({
			...base,
			ranked: [candidate("cold-model", 80), candidate("hot-model", 69)],
			lastShellKeyByModel: ledger({ "hot-model": { shellKey: shell("worker", "hot-model") } }),
		});
		expect(result.ranked.map((entry) => entry.modelKey)).toEqual(["cold-model", "hot-model"]);
		expect(result.warmthApplied).toBe(false);
		expect(result.warmthReason).toBeNull();
	});

	it("WARM (same workspace, different kind) gets only HALF the margin", () => {
		const warmLedger = ledger({ "warm-model": { shellKey: shell("review", "warm-model") } });
		const within = applyWarmthPreference({
			...base,
			ranked: [candidate("cold-model", 80), candidate("warm-model", 76)],
			lastShellKeyByModel: warmLedger,
		});
		expect(within.ranked[0]?.modelKey).toBe("warm-model");
		expect(within.warmthReason).toContain("WARM");
		const beyond = applyWarmthPreference({
			...base,
			ranked: [candidate("cold-model", 80), candidate("warm-model", 74)],
			lastShellKeyByModel: warmLedger,
		});
		expect(beyond.ranked[0]?.modelKey).toBe("cold-model");
		expect(beyond.warmthApplied).toBe(false);
	});

	it("prefers HOT over a higher-ranked WARM candidate (both in margin)", () => {
		const result = applyWarmthPreference({
			...base,
			ranked: [candidate("cold-model", 80), candidate("warm-model", 79), candidate("hot-model", 72)],
			lastShellKeyByModel: ledger({
				"warm-model": { shellKey: shell("review", "warm-model") },
				"hot-model": { shellKey: shell("worker", "hot-model") },
			}),
		});
		expect(result.ranked[0]?.modelKey).toBe("hot-model");
	});

	it("STALE warmth counts cold (the server may have evicted the prefix)", () => {
		const result = applyWarmthPreference({
			...base,
			ranked: [candidate("cold-model", 80), candidate("hot-model", 72)],
			lastShellKeyByModel: ledger({
				"hot-model": { shellKey: shell("worker", "hot-model"), at: NOW - DEFAULT_WARMTH_STALE_AFTER_MS - 1 },
			}),
		});
		expect(result.ranked[0]?.modelKey).toBe("cold-model");
		expect(result.warmthApplied).toBe(false);
	});

	it("leaves the order alone when the top pick is already hot (nothing to observe)", () => {
		const result = applyWarmthPreference({
			...base,
			ranked: [candidate("hot-model", 80), candidate("other-hot", 79)],
			lastShellKeyByModel: ledger({
				"hot-model": { shellKey: shell("worker", "hot-model") },
				"other-hot": { shellKey: shell("worker", "other-hot") },
			}),
		});
		expect(result.ranked[0]?.modelKey).toBe("hot-model");
		expect(result.warmthApplied).toBe(false);
	});

	it("a WARM top pick is not shuffled among equals, but a HOT candidate in margin still wins", () => {
		const warmTopLedger = ledger({
			"warm-top": { shellKey: shell("review", "warm-top") },
			"warm-second": { shellKey: shell("review", "warm-second") },
		});
		const unchanged = applyWarmthPreference({
			...base,
			ranked: [candidate("warm-top", 80), candidate("warm-second", 79)],
			lastShellKeyByModel: warmTopLedger,
		});
		expect(unchanged.ranked[0]?.modelKey).toBe("warm-top");
		expect(unchanged.warmthApplied).toBe(false);
		const hotWins = applyWarmthPreference({
			...base,
			ranked: [candidate("warm-top", 80), candidate("hot-model", 73)],
			lastShellKeyByModel: ledger({
				"warm-top": { shellKey: shell("review", "warm-top") },
				"hot-model": { shellKey: shell("worker", "hot-model") },
			}),
		});
		expect(hotWins.ranked[0]?.modelKey).toBe("hot-model");
	});

	it("handles empty candidate lists and an empty ledger without applying warmth", () => {
		expect(applyWarmthPreference({ ...base, ranked: [], lastShellKeyByModel: new Map() }).warmthApplied).toBe(false);
		const result = applyWarmthPreference({
			...base,
			ranked: [candidate("a", 80), candidate("b", 79)],
			lastShellKeyByModel: new Map(),
		});
		expect(result.ranked[0]?.modelKey).toBe("a");
		expect(result.warmthApplied).toBe(false);
	});

	it("DIVERSITY-FIRST contract: warmth only re-orders what diversity allows — a same-lineage warm model filtered out by the diversity gate can never be promoted back", () => {
		// The decision-role flow (pickDiverseReviewerModel): diversity FIRST, authoritative; warmth second, on the
		// diverse subset only. The warm-but-same-lineage model never reaches warmth's input, so warmth cannot
		// resurrect it — rails never silently sacrifice §5.AB diversity.
		const ranked = [
			{ modelKey: "openai/gpt-oss-120b", modelId: "openai/gpt-oss-120b", score: 50 },
			{ modelKey: "qwen3.5-9b-mlx", modelId: "qwen3.5-9b-mlx", score: 50 },
		];
		const diverse = applyDiversityPreference({ ranked, avoidLineages: ["gpt-oss"] });
		expect(diverse.diversityAchieved).toBe(true);
		const diverseOnly = diverse.ranked.filter((entry) => entry.modelId !== "openai/gpt-oss-120b");
		const result = applyWarmthPreference({
			...base,
			sessionKind: "review",
			// The excluded gpt-oss model is the ONLY hot one — and it is not in warmth's input set.
			ranked: diverseOnly,
			lastShellKeyByModel: ledger({ "openai/gpt-oss-120b": { shellKey: shell("review", "openai/gpt-oss-120b") } }),
		});
		expect(result.ranked.map((entry) => entry.modelKey)).toEqual(["qwen3.5-9b-mlx"]);
		expect(result.warmthApplied).toBe(false);
	});
});
