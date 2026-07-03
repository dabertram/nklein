import { describe, expect, it } from "vitest";
import {
	DEFAULT_RUNTIME_SKILL_DYNAMICS_LEVEL,
	type RuntimeSkillDynamicsLevel,
} from "../../../src/core/runtime-config-api-contract";
import {
	DEFAULT_SKILL_DYNAMICS_LEVEL,
	resolveActiveSkills,
	type SkillDynamicsLevel,
} from "../../../src/core/skill-resolver";
import { resolveLoadedFallbackLaunchConfig } from "../../../src/trpc/runtime-api/start-task-session";

/** Fake fetch returning an `/api/v0/models` payload with the given ids all `loaded`. */
function loadedFetch(ids: string[]): typeof fetch {
	return (async () =>
		({
			ok: true,
			json: async () => ({ data: ids.map((id) => ({ id, state: "loaded" })) }),
		}) as Response) as unknown as typeof fetch;
}

// Minimal launch-config stand-in — the helper just returns whatever the resolver yields.
const cfg = (modelId: string) =>
	({
		providerId: "lmstudio",
		modelId,
		contextWindow: 40000,
		apiKey: null,
		baseUrl: "http://x/v1",
		reasoningEffort: null,
	}) as never;

describe("resolveLoadedFallbackLaunchConfig", () => {
	it("returns the first loaded NON-embedding model that resolves", async () => {
		const result = await resolveLoadedFallbackLaunchConfig({
			resolveLaunchConfig: async ({ modelIdOverride }) => cfg(modelIdOverride),
			baseUrl: "http://x/v1",
			fetchImpl: loadedFetch(["text-embedding-nomic", "coder-14b", "general-9b"]),
		});
		expect(result?.modelId).toBe("coder-14b"); // embedding skipped, first real model wins
	});

	it("skips a loaded model whose resolve throws (e.g. context policy) and tries the next", async () => {
		const result = await resolveLoadedFallbackLaunchConfig({
			resolveLaunchConfig: async ({ modelIdOverride }) => {
				if (modelIdOverride === "bad") {
					throw new Error("context policy violation");
				}
				return cfg(modelIdOverride);
			},
			baseUrl: "http://x/v1",
			fetchImpl: loadedFetch(["bad", "good"]),
		});
		expect(result?.modelId).toBe("good");
	});

	it("returns null when no loaded model resolves (⇒ caller re-throws the ORIGINAL error)", async () => {
		const result = await resolveLoadedFallbackLaunchConfig({
			resolveLaunchConfig: async () => {
				throw new Error("nope");
			},
			baseUrl: "http://x/v1",
			fetchImpl: loadedFetch(["a", "b"]),
		});
		expect(result).toBeNull();
	});

	it("returns null on an empty / unreachable loaded set (behaves exactly as before)", async () => {
		expect(
			await resolveLoadedFallbackLaunchConfig({
				resolveLaunchConfig: async ({ modelIdOverride }) => cfg(modelIdOverride),
				baseUrl: "http://x/v1",
				fetchImpl: loadedFetch([]),
			}),
		).toBeNull();
	});
});

// §5.AE skill-dynamics live-wiring (SEAM 1): `handleStartTaskSession` now threads
// `scopedRuntimeConfig.effectiveSkillDynamicsLevel` into `resolveActiveSkills` (role = worker for an act card,
// architect for a plan card — the seam's exact role derivation). The persisted config value is a
// `RuntimeSkillDynamicsLevel`, which is 1:1 with the resolver's `SkillDynamicsLevel`; this suite pins that contract and
// the resulting divergence directly against the two REAL modules the seam composes (the persisted-config type +
// the resolver), so a drift in either the enum or the resolver bundle fails here.
describe("skill-dynamics wiring: persisted level → resolveActiveSkills (SEAM 1 contract)", () => {
	// The card text a worker act-card carries at the seam (`${taskTitle}\n${prompt}`). It deliberately fires MULTIPLE
	// skills' keywords — code (`implement`/`fix`/`refactor`/`bug`), review (`review`/`verify`), and web
	// (`search`/`latest`/`documentation`) — so relevance selects MORE than the bare worker bundle, making the
	// dynamic-vs-static divergence observable (static prunes back to the role bundle alone).
	const WORKER_TASK_TEXT =
		"Add caching layer\nImplement and refactor the cache function; fix the bug in the file, review and verify it, and search the latest documentation.";

	it("RuntimeSkillDynamicsLevel is 1:1 with SkillDynamicsLevel — the persisted value passes through with no mapping", () => {
		// A compile-time-checked round-trip: each contract value is assignable to the resolver's level (and vice versa),
		// so the seam can pass `scopedRuntimeConfig.effectiveSkillDynamicsLevel` straight into `dynamicsLevel`.
		const fromContract: SkillDynamicsLevel = "static_skills_auto_model" satisfies RuntimeSkillDynamicsLevel;
		const fromResolver: RuntimeSkillDynamicsLevel = "fully_dynamic" satisfies SkillDynamicsLevel;
		expect(fromContract).toBe("static_skills_auto_model");
		expect(fromResolver).toBe("fully_dynamic");
		// The two defaults are the SAME literal, which is what makes the seam byte-identical at config default.
		expect(DEFAULT_RUNTIME_SKILL_DYNAMICS_LEVEL).toBe(DEFAULT_SKILL_DYNAMICS_LEVEL);
	});

	it("DEFAULT config (`fully_dynamic`) selects by relevance — the role bundle PLUS keyword-matched skills (byte-identical to omitting the level)", () => {
		// The seam's default: effectiveSkillDynamicsLevel === "fully_dynamic" === the resolver default.
		const withDefaultLevel = resolveActiveSkills({
			role: "worker",
			taskText: WORKER_TASK_TEXT,
			dynamicsLevel: "fully_dynamic",
		}).skills.map((skill) => skill.id);
		const withoutLevel = resolveActiveSkills({ role: "worker", taskText: WORKER_TASK_TEXT }).skills.map(
			(skill) => skill.id,
		);
		// Passing the default level is identical to omitting it (the pre-wiring behavior) — the byte-identical guarantee.
		expect(withDefaultLevel).toEqual(withoutLevel);
		// Relevance is in force: the worker bundle (`code_editing`) PLUS the keyword-matched skills — strictly MORE than
		// the static bundle, which is exactly the set a static level prunes away.
		expect(withDefaultLevel).toContain("code_editing");
		expect(withDefaultLevel).toContain("review");
		expect(withDefaultLevel).toContain("web_retrieval");
		expect(withDefaultLevel.length).toBeGreaterThan(1);
	});

	it("a persisted STATIC level yields exactly the worker ROLE STATIC BUNDLE (`code_editing`), NOT the wider relevance-selected set", () => {
		for (const level of ["static_skills_auto_model", "fully_static"] satisfies RuntimeSkillDynamicsLevel[]) {
			const skillIds = resolveActiveSkills({
				role: "worker",
				taskText: WORKER_TASK_TEXT,
				dynamicsLevel: level,
			}).skills.map((skill) => skill.id);
			// The worker default bundle is exactly `code_editing`; a static level returns the bundle unchanged.
			expect(skillIds).toEqual(["code_editing"]);
		}
	});

	it("the architect ROLE STATIC BUNDLE for a plan card is `planning` (the plan-mode branch of the seam's role derivation)", () => {
		const skillIds = resolveActiveSkills({
			role: "architect",
			taskText: "Design the ingestion pipeline\nDecompose the approach and plan the architecture.",
			dynamicsLevel: "fully_static",
		}).skills.map((skill) => skill.id);
		expect(skillIds).toEqual(["planning"]);
	});
});
