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
import type { PromptFragment } from "../core/prompt-fragment-assembly.js";
import { selectSandboxMcpServersForModel } from "../core/sandbox-mcp-catalog.js";
import { buildSkillPromptFragments } from "../core/skill-prompt-fragments.js";
import { resolveActiveSkills, type SkillDynamicsLevel } from "../core/skill-resolver.js";
import { buildStructuralRetrievalGuidance } from "../core/structural-retrieval-guidance.js";
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

	return fragments;
}
