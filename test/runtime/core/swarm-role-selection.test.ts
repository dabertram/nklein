import { describe, expect, it } from "vitest";
import { buildPromptShellKey, type PromptWarmthLedgerEntry } from "../../../src/core/cache-warmth";
import { resolveSwarmRoleModel } from "../../../src/core/swarm-role-selection";

const candidate = (modelId: string, score: number, extra?: { realModelId?: string; isPinned?: boolean }) => ({
	modelKey: `lmstudio:${modelId}`,
	modelId,
	score,
	...(extra?.realModelId !== undefined ? { realModelId: extra.realModelId } : {}),
	...(extra?.isPinned !== undefined ? { isPinned: extra.isPinned } : {}),
});

const warmthLedger = (entries: Record<string, string>, at = 1_000): ReadonlyMap<string, PromptWarmthLedgerEntry> =>
	new Map(Object.entries(entries).map(([modelId, shellKey]) => [modelId, { shellKey, at }]));

describe("resolveSwarmRoleModel (W2.5 pin-vs-auto: config = optional pin layered on auto)", () => {
	it("honors a loaded pin absolutely (caller-tagged pin membership wins over higher-scored candidates)", () => {
		const pinnedWorker = candidate("qwen2.5-coder-14b", 60, { isPinned: true });
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: { providerId: "lmstudio", modelId: "qwen2.5-coder-14b" },
			candidates: [candidate("openai/gpt-oss-120b", 90), pinnedWorker],
		});
		expect(result.source).toBe("pinned");
		expect(result.pick).toBe(pinnedWorker);
		expect(result.reasons.join(" ")).toContain("honoring the configured pin");
	});

	it("honors a pin by identity match when the caller did not tag pin membership", () => {
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: { providerId: "lmstudio", modelId: "gemma-3-27b" },
			candidates: [candidate("qwen3.5-9b", 80), candidate("gemma-3-27b", 55)],
		});
		expect(result.source).toBe("pinned");
		expect(result.pick?.modelId).toBe("gemma-3-27b");
	});

	it("takes the FIRST pinned candidate in the caller's order (primary-then-pool role pools)", () => {
		const primary = candidate("worker-primary", 40, { isPinned: true });
		const poolMember = candidate("worker-extra", 70, { isPinned: true });
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: { providerId: "lmstudio", modelId: "worker-primary" },
			candidates: [primary, poolMember],
		});
		expect(result.pick).toBe(primary);
	});

	it("waives an unavailable pin to AUTO with a surfaced reason — never a hard failure", () => {
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: { providerId: "lmstudio", modelId: "not-loaded-model" },
			candidates: [candidate("qwen3.5-9b", 80)],
		});
		expect(result.source).toBe("auto");
		expect(result.pick?.modelId).toBe("qwen3.5-9b");
		expect(result.reasons.join(" ")).toContain("not loaded/runnable");
		expect(result.reasons.join(" ")).toContain("pin waived");
	});

	it("returns a null pick with a reason when no candidate exists at all", () => {
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: { providerId: "lmstudio", modelId: "not-loaded-model" },
			candidates: [],
		});
		expect(result.pick).toBeNull();
		expect(result.source).toBe("auto");
		expect(result.reasons.join(" ")).toContain("No candidates available");
	});

	it("stays silent (empty reasons) on the plain unconfigured auto path", () => {
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: null,
			candidates: [candidate("qwen3.5-9b", 80), candidate("gemma-3-27b", 70)],
		});
		expect(result.source).toBe("auto");
		expect(result.pick?.modelId).toBe("qwen3.5-9b");
		expect(result.reasons).toEqual([]);
	});

	it("applies lineage diversity for DECISION roles (same-lineage top demoted within the margin)", () => {
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: null,
			candidates: [candidate("qwen3.5-27b", 85), candidate("gemma-3-27b", 78)],
			diversityAvoidLineages: ["qwen"],
		});
		expect(result.pick?.modelId).toBe("gemma-3-27b");
		expect(result.diversityAchieved).toBe(true);
		expect(result.diversityWaived).toBeNull();
	});

	it("does NOT apply diversity for GENERATION roles (Self-MoA — pure fit ranking stands)", () => {
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: null,
			candidates: [candidate("qwen3.5-27b", 85), candidate("gemma-3-27b", 78)],
			diversityAvoidLineages: ["qwen"],
		});
		expect(result.pick?.modelId).toBe("qwen3.5-27b");
		expect(result.diversityWaived).toBeNull();
	});

	it("surfaces the diversity waiver on a single-lineage fleet (order stands, never silent)", () => {
		const result = resolveSwarmRoleModel({
			role: "critic",
			pinned: null,
			candidates: [candidate("qwen3.5-27b", 85), candidate("qwq-32b", 78)],
			diversityAvoidLineages: ["qwen"],
		});
		expect(result.pick?.modelId).toBe("qwen3.5-27b");
		expect(result.diversityAchieved).toBe(false);
		expect(result.diversityWaived).toContain("no lineage-diverse candidate");
	});

	it("honors a correlated pin but REPORTS the waived diversity (pin wins, waiver surfaced)", () => {
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: { providerId: "lmstudio", modelId: "qwen3.5-27b" },
			candidates: [candidate("gemma-3-27b", 80), candidate("qwen3.5-27b", 70)],
			diversityAvoidLineages: ["qwen"],
		});
		expect(result.source).toBe("pinned");
		expect(result.pick?.modelId).toBe("qwen3.5-27b");
		expect(result.diversityAchieved).toBe(false);
		expect(result.diversityWaived).toContain("pin honored, diversity waived by configuration");
	});

	it("composes warmth AFTER diversity: a hot same-lineage candidate never outranks the diverse pick", () => {
		// Reviewer pick avoiding qwen. gemma (diverse) is promoted by diversity; the qwen candidate has a HOT
		// review shell but sits outside the diversity-allowed set — warmth must not resurrect it.
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: null,
			candidates: [candidate("qwen3.5-27b", 85), candidate("gemma-3-27b", 78), candidate("mistral-small", 76)],
			diversityAvoidLineages: ["qwen"],
			warmth: {
				sessionKind: "review",
				workspacePath: "/repo",
				lastShellKeyByModel: warmthLedger({
					"qwen3.5-27b": buildPromptShellKey({
						sessionKind: "review",
						workspacePath: "/repo",
						modelId: "qwen3.5-27b",
					}),
				}),
				now: 2_000,
			},
		});
		expect(result.pick?.modelId).toBe("gemma-3-27b");
		expect(result.warmthReason).toBeNull();
	});

	it("lets warmth re-order WITHIN the diversity-allowed set (hot diverse candidate promoted, margin-bounded)", () => {
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: null,
			candidates: [candidate("qwen3.5-27b", 85), candidate("gemma-3-27b", 78), candidate("mistral-small", 76)],
			diversityAvoidLineages: ["qwen"],
			warmth: {
				sessionKind: "review",
				workspacePath: "/repo",
				lastShellKeyByModel: warmthLedger({
					"mistral-small": buildPromptShellKey({
						sessionKind: "review",
						workspacePath: "/repo",
						modelId: "mistral-small",
					}),
				}),
				now: 2_000,
			},
		});
		// Diversity promotes gemma to the top; mistral (also diverse) is HOT and within the warmth margin of it.
		expect(result.pick?.modelId).toBe("mistral-small");
		expect(result.warmthReason).toContain("HOT");
		expect(result.reasons.join(" ")).toContain("after diversity");
	});

	it("applies warmth for generation roles over the full ranked list (no diversity gate)", () => {
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: null,
			candidates: [candidate("qwen3.5-27b", 85), candidate("gemma-3-27b", 80)],
			warmth: {
				sessionKind: "worker",
				workspacePath: "/repo",
				lastShellKeyByModel: warmthLedger({
					"gemma-3-27b": buildPromptShellKey({
						sessionKind: "worker",
						workspacePath: "/repo",
						modelId: "gemma-3-27b",
					}),
				}),
				now: 2_000,
			},
		});
		expect(result.pick?.modelId).toBe("gemma-3-27b");
		expect(result.warmthReason).toContain("HOT");
	});

	it("never applies warmth over a pin (the pin is the user's explicit choice)", () => {
		const pinnedPick = candidate("qwen3.5-27b", 85, { isPinned: true });
		const result = resolveSwarmRoleModel({
			role: "worker",
			pinned: { providerId: "lmstudio", modelId: "qwen3.5-27b" },
			candidates: [pinnedPick, candidate("gemma-3-27b", 84)],
			warmth: {
				sessionKind: "worker",
				workspacePath: "/repo",
				lastShellKeyByModel: warmthLedger({
					"gemma-3-27b": buildPromptShellKey({
						sessionKind: "worker",
						workspacePath: "/repo",
						modelId: "gemma-3-27b",
					}),
				}),
				now: 2_000,
			},
		});
		expect(result.source).toBe("pinned");
		expect(result.pick).toBe(pinnedPick);
		expect(result.warmthReason).toBeNull();
	});

	it("resolves lineage on realModelId (the REAL publisher key), not a per-machine alias", () => {
		// The served alias "coder-gpu" is lineage-unknown; the real key marks it qwen — diversity must see qwen.
		const result = resolveSwarmRoleModel({
			role: "reviewer",
			pinned: null,
			candidates: [candidate("coder-gpu", 85, { realModelId: "qwen2.5-coder-14b" }), candidate("gemma-3-27b", 80)],
			diversityAvoidLineages: ["qwen"],
		});
		expect(result.pick?.modelId).toBe("gemma-3-27b");
		expect(result.diversityAchieved).toBe(true);
	});
});
