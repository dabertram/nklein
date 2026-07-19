/**
 * §5.AE: build the skill-driven system-prompt fragments for a task session (the effectful side of the approved
 * skill→fragment bridge). Resolves the session's active skills, then routes their `wired` context fragments through
 * {@link buildSkillPromptFragments} with REAL producers.
 *
 * Today the one producer that adds a NEW system-prompt block is `repo_map` — `buildNKleinRepoMap().rendered` (the
 * repo map is already prompt-ready text). The other `wired` fragments (efficiency_rules, temporal) overlap the blocks
 * `assembleSessionSystemPrompt` already injects unconditionally and are deduped away there, so this only ever ADDS a
 * repo map (for a code/planning session) — never duplicates. Async (repo-map reads the workspace); fail-soft to `[]`.
 */

import { isTruthyEnv } from "../core/env-flag.js";
import { selectFragmentsWithinBudget } from "../core/jit-fragment-budget";
import type { ProceduralSkill } from "../core/procedural-skill-record.js";
import { deriveProceduralContextTags, matchProceduralSkills } from "../core/procedural-skill-retrieval.js";
import type { PromptFragment } from "../core/prompt-fragment-assembly.js";
import { selectSandboxMcpServersForModel } from "../core/sandbox-mcp-catalog.js";
import { buildSkillPromptFragments } from "../core/skill-prompt-fragments.js";
import { resolveActiveSkills, type SkillDynamicsLevel } from "../core/skill-resolver.js";
import { buildStructuralRetrievalGuidance } from "../core/structural-retrieval-guidance.js";
import { getCurrentProceduralSkills } from "../state/procedural-skill-store.js";
import { buildNKleinRepoMap } from "./nklein-repo-map.js";

export interface BuildSessionSkillFragmentsInput {
	/** The session's role (worker / architect / …) — anchors the default skill bundle. */
	role: string | null;
	/** The task text (title + prompt) — raises skill relevance for the dynamic levels. */
	taskText: string;
	/** The HOST workspace root — required to build the repo map; when null, repo_map is skipped. */
	workspacePath: string | null;
	/** Optional repo-map token budget (defaults to the builder's own). */
	repoMapTokenBudget?: number;
	/** The session's model id — drives which curated sandbox MCP servers are offered (the structural-retrieval nudge). */
	modelId?: string | null;
	/** Whether curated sandbox MCP servers are offered this session (the same gate the tool bundle uses). */
	sandboxMcpEnabled?: boolean;
	/**
	 * §5.AF: the sandbox pool's per-container memory limit (MB). Threaded so the structural-retrieval nudge applies the
	 * SAME memory-fit gate as the tool bundle — a heavy server (codebase-memory) withheld from a small container must not
	 * be advertised in guidance. Absent ⇒ unbounded (the memory gate does not engage), matching the tool bundle's default.
	 */
	sandboxContainerMemoryLimitMb?: number;
	/**
	 * §5.AE the user's effective skill-dynamics level (global default ← per-project override). Drives WHICH skills
	 * `resolveActiveSkills` selects (role bundle vs relevance-scored vs assigned) — so the repo-map/other fragments this
	 * session actually carries honor the setting. Absent ⇒ the resolver's own default (`fully_dynamic`).
	 */
	dynamicsLevel?: SkillDynamicsLevel;
	/**
	 * F4.19 — injectable procedural-skill loader (tests). Defaults to the runtime store's `getCurrentProceduralSkills`.
	 * Only consulted when `NKLEIN_PROCEDURAL_SKILLS` is set; a rejecting loader yields no fragments (fail-soft).
	 */
	loadProceduralSkills?: () => Promise<ProceduralSkill[]>;
	/**
	 * F4.17 overflow capping: token budget for the OPTIONAL skill-driven fragments (repo map, exemplars,
	 * procedures, structural nudge). Unset ⇒ no capping (byte-identical). When set, fragments are ranked by
	 * importance and greedily kept within the budget via `selectFragmentsWithinBudget` — one skill-driven pile
	 * can never blow a small window.
	 */
	fragmentBudgetTokens?: number;
}

/** Resolve active skills → their `wired` context fragments → assembler PromptFragments (with real producer text). */
export async function buildSessionSkillFragments(input: BuildSessionSkillFragmentsInput): Promise<PromptFragment[]> {
	const fragments: PromptFragment[] = [];

	// §5.AR structural-retrieval nudge — pure + cheap (no I/O), so it is NOT gated behind the repo-map scan flag. It is
	// added ONLY when a structural code-graph MCP server (codebase-memory) is actually offered to this model, via the
	// SAME §5.AL model-fit AND §5.AF memory-fit gates that add its tools — so guidance and tool can never disagree (incl.
	// when codebase-memory is withheld from a too-small container to avoid the OOM-under-load kill).
	if (input.sandboxMcpEnabled && input.modelId) {
		const offeredServerIds = selectSandboxMcpServersForModel(input.modelId, input.sandboxContainerMemoryLimitMb).map(
			(server) => server.id,
		);
		const guidance = buildStructuralRetrievalGuidance(offeredServerIds);
		if (guidance) {
			fragments.push({ key: "structural-retrieval", volatility: "config", text: guidance });
		}
	}

	// §5.AE repo-map fragment — opt-in (default OFF): building a repo map is a real workspace scan, so it's gated.
	// Enabling it makes a code/planning session's system prompt carry a repo map. Off ⇒ no repo map (no scan).
	if (isTruthyEnv(process.env.NKLEIN_SKILL_PROMPT_FRAGMENTS)) {
		const activeFragments = resolveActiveSkills({
			role: input.role,
			taskText: input.taskText,
			...(input.dynamicsLevel !== undefined ? { dynamicsLevel: input.dynamicsLevel } : {}),
		}).fragments;
		if (activeFragments.length > 0) {
			// Pre-compute the async producer text (repo map) ONLY when a skill actually declares it — the builder is a
			// real workspace scan, so we never pay it for a session whose skills don't want a repo map.
			let repoMapText = "";
			if (activeFragments.includes("repo_map") && input.workspacePath) {
				repoMapText = await buildNKleinRepoMap({
					workspacePath: input.workspacePath,
					...(input.repoMapTokenBudget !== undefined ? { tokenBudget: input.repoMapTokenBudget } : {}),
				})
					.then((map) => map.rendered)
					.catch(() => "");
			}
			fragments.push(
				...buildSkillPromptFragments(activeFragments, (fragmentId) =>
					fragmentId === "repo_map" ? repoMapText : null,
				),
			);
		}
	}

	// F4.19 — surface matched PROCEDURAL skills (the ProceduralSkillBank consumer side). Opt-in (NKLEIN_PROCEDURAL_SKILLS,
	// default OFF = byte-identical) + empty-safe: only ACTIVE, not-superseded procedures whose applicability tags overlap
	// the task's context are added (never an unvalidated skill). A missing/unreadable store yields nothing.
	if (isTruthyEnv(process.env.NKLEIN_PROCEDURAL_SKILLS)) {
		const contextTags = deriveProceduralContextTags(input.role, input.taskText);
		const skills = await (input.loadProceduralSkills ?? getCurrentProceduralSkills)().catch(() => []);
		for (const { skill } of matchProceduralSkills(skills, contextTags)) {
			fragments.push({
				key: `procedural-skill:${skill.id}`,
				volatility: "config",
				text: `Learned procedure — ${skill.title}:\n${skill.content}`,
			});
		}
	}

	// F4.17 overflow capping (opt-in budget): every skill-driven fragment is OPTIONAL — rank and keep within the
	// budget; the structural-retrieval nudge ranks highest (guidance must match offered tools), procedures next,
	// bulk retrieval fragments last. No budget ⇒ byte-identical.
	if (input.fragmentBudgetTokens !== undefined && fragments.length > 0) {
		const importanceFor = (key: string): number =>
			key === "structural-retrieval" ? 2 : key.startsWith("procedural-skill:") ? 1 : 0;
		const selection = selectFragmentsWithinBudget(
			fragments.map((fragment) => ({
				id: fragment.key,
				estimatedTokens: Math.ceil(fragment.text.length / 4),
				importance: importanceFor(fragment.key),
			})),
			input.fragmentBudgetTokens,
		);
		const kept = new Set(selection.kept);
		return fragments.filter((fragment) => kept.has(fragment.key));
	}
	return fragments;
}
