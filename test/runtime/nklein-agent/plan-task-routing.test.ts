import { describe, expect, it } from "vitest";
import {
	estimateTaskWallTimeMs,
	formatTaskModelFitEvidence,
	selectTaskRoutingCandidate,
} from "../../../src/nklein-agent/decomposition/plan-task-routing";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import type { NKleinPlanTask } from "../../../src/nklein-agent/nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../../../src/nklein-agent/nklein-task-router";

function createEntry(input: {
	key: string;
	capability: number;
	contextWindow: number;
	prefillTokensPerSecond?: number | null;
	decodeTokensPerSecond?: number | null;
	ttftMs?: number | null;
	wallTimeMs?: number | null;
}): NKleinModelRegistryEntry {
	const [providerId = "provider", modelId = input.key, endpoint = "default"] = input.key.split(":");
	return {
		key: input.key,
		providerId,
		modelId,
		endpoint,
		contextWindow: {
			advertised: input.contextWindow,
			observed: null,
			userOverride: null,
			effective: input.contextWindow,
		},
		speed: {
			samples: 1,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: input.prefillTokensPerSecond ?? null,
			decodeTokensPerSecondEwma: input.decodeTokensPerSecond ?? null,
			ttftMsEwma: input.ttftMs ?? null,
			wallTimeMsEwma: input.wallTimeMs ?? null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 1,
			staticPrior: input.capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: input.capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: endpoint,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

function candidate(
	over: Partial<{ entry: NKleinModelRegistryEntry; role: string | null }> = {},
): NKleinTaskRoutingCandidate {
	return {
		entry: over.entry ?? createEntry({ key: "lmstudio:qwen3-8b:default", capability: 72, contextWindow: 32_768 }),
		role: over.role ?? null,
	};
}

describe("formatTaskModelFitEvidence", () => {
	it("explains the not-yet-validated and default-model cases", () => {
		expect(formatTaskModelFitEvidence(undefined)).toMatch(/not validated before card creation/u);
		expect(formatTaskModelFitEvidence(null)).toMatch(/default local model/u);
	});

	it("names the provider/model and includes role, context, and capability for a real candidate", () => {
		const evidence = formatTaskModelFitEvidence(candidate({ role: "worker" }));
		expect(evidence).toContain("lmstudio / qwen3-8b");
		expect(evidence).toContain("role worker");
		expect(evidence).toContain("context 32,768"); // toLocaleString
		expect(evidence).toContain("capability 72");
	});
});

describe("estimateTaskWallTimeMs", () => {
	it("is null without a candidate", () => {
		expect(estimateTaskWallTimeMs(null, 1000)).toBeNull();
		expect(estimateTaskWallTimeMs(undefined, 1000)).toBeNull();
	});

	it("estimates from prefill + decode speed + ttft", () => {
		const c = candidate({
			entry: createEntry({
				key: "lmstudio:m:default",
				capability: 50,
				contextWindow: 8_000,
				prefillTokensPerSecond: 500,
				decodeTokensPerSecond: 50,
				ttftMs: 200,
			}),
		});
		// prefill (1000/500*1000? no): (promptTokens/prefill)*1000 = (500/500)*1000 = 1000; decode (1000/50)*1000 = 20000; + ttft 200
		expect(estimateTaskWallTimeMs(c, 500)).toBe(21_200);
	});

	it("falls back to the wall-time EWMA when prefill/decode speed is unknown", () => {
		const c = candidate({
			entry: createEntry({ key: "lmstudio:m:default", capability: 50, contextWindow: 8_000, wallTimeMs: 9_999 }),
		});
		expect(estimateTaskWallTimeMs(c, 500)).toBe(9_999);
	});
});

// §5.AE skill-dynamics live-wiring (SEAM 2): `selectTaskRoutingCandidate` now threads the persisted
// `dynamicsLevel` into `resolveActiveSkills`, so the resolved skills — and thus the task's affinity tags that steer
// model routing — differ for a static level. Observed here through WHICH candidate the router picks: a code-tagged
// vs a web-tagged model, given a researcher-role card whose text also carries code keywords.
describe("selectTaskRoutingCandidate — skill-dynamics level threads into affinity routing", () => {
	// Two equally-feasible LOCAL candidates that differ only in affinity tag + capability. Neither carries the card's
	// role, so no preferred-model short-circuit fires and the affinity comparison alone decides the pick. The code model
	// carries the `code_editing`-skill tags (`code`+`agentic`); the web model carries only `web`. Router order: MORE
	// task-tag overlap first, then smallest-sufficient (LOWER capability) as the tie-break.
	const codeCandidate: NKleinTaskRoutingCandidate = {
		entry: createEntry({ key: "lmstudio:coder-14b:default", capability: 90, contextWindow: 131_072 }),
		role: null,
		affinityTags: ["code", "agentic"],
	};
	const webCandidate: NKleinTaskRoutingCandidate = {
		entry: createEntry({ key: "lmstudio:web-9b:default", capability: 80, contextWindow: 131_072 }),
		role: null,
		affinityTags: ["web"],
	};
	const candidates = [codeCandidate, webCandidate];
	// A researcher-role card (⇒ static bundle = `web_retrieval`) whose text ALSO fires code keywords (⇒ under the
	// dynamic default, relevance additionally pulls in `code_editing`, so the task wants the `code` tag too).
	const task = {
		id: "t1",
		title: "Add caching layer",
		prompt: "Implement and refactor the cache function; fix the bug in the file.",
		dependsOn: [],
		complexity: 10,
		suggestedRole: "researcher",
		filesLikelyTouched: [],
		acceptanceCommand: null,
		testFirst: false,
		acceptanceTestPrompt: null,
	} satisfies NKleinPlanTask;

	it("DEFAULT (no dynamicsLevel ⇒ fully_dynamic): relevance adds code_editing, so the task wants `code` and the code model wins", () => {
		// task tags = {agentic, web, code} (web_retrieval role match + code_editing keyword match): the code model
		// overlaps 2 (code+agentic), the web model 1 (web) ⇒ more overlap wins ⇒ the code model.
		const picked = selectTaskRoutingCandidate(task, task.prompt, candidates);
		expect(picked?.entry.key).toBe("lmstudio:coder-14b:default");
	});

	it("explicit `fully_dynamic` is byte-identical to the default (the code model still wins)", () => {
		const picked = selectTaskRoutingCandidate(task, task.prompt, candidates, "fully_dynamic");
		expect(picked?.entry.key).toBe("lmstudio:coder-14b:default");
	});

	it("`fully_static`: only the role's static bundle (`web_retrieval`) resolves, so the task no longer wants `code` and the web model wins over the higher-capability code model", () => {
		// task tags = {agentic, web} (web_retrieval only — no code_editing): the code model overlaps 1 (agentic), the web
		// model 1 (web) ⇒ overlap tie ⇒ smallest-sufficient (lower capability) breaks it ⇒ the 80-cap web model. Contrast
		// the dynamic case, where the code model's extra `code` overlap won — that swing IS the wired divergence.
		const picked = selectTaskRoutingCandidate(task, task.prompt, candidates, "fully_static");
		expect(picked?.entry.key).toBe("lmstudio:web-9b:default");
	});

	it("`static_skills_auto_model` resolves the SAME static bundle as `fully_static` (both ⇒ the web model)", () => {
		const picked = selectTaskRoutingCandidate(task, task.prompt, candidates, "static_skills_auto_model");
		expect(picked?.entry.key).toBe("lmstudio:web-9b:default");
	});
});
