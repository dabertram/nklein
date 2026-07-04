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
import { buildSkillPromptFragments } from "../core/skill-prompt-fragments.js";
import { resolveActiveSkills } from "../core/skill-resolver.js";
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
}

/** Resolve active skills → their `wired` context fragments → assembler PromptFragments (with real producer text). */
export async function buildSessionSkillFragments(input: BuildSessionSkillFragmentsInput): Promise<PromptFragment[]> {
	// Opt-in (default OFF): building a repo map is a real workspace scan, so it's gated — enabling it makes a
	// code/planning session's system prompt carry a repo map. Off ⇒ [] before any scan ⇒ byte-identical current start.
	if (!isTruthyEnv(process.env.NKLEIN_SKILL_PROMPT_FRAGMENTS)) {
		return [];
	}
	const activeFragments = resolveActiveSkills({ role: input.role, taskText: input.taskText }).fragments;
	if (activeFragments.length === 0) {
		return [];
	}
	// Pre-compute the async producer text (repo map) ONLY when a skill actually declares it — the builder is a real
	// workspace scan, so we never pay it for a session whose skills don't want a repo map.
	let repoMapText = "";
	if (activeFragments.includes("repo_map") && input.workspacePath) {
		repoMapText = await buildNKleinRepoMap({
			workspacePath: input.workspacePath,
			...(input.repoMapTokenBudget !== undefined ? { tokenBudget: input.repoMapTokenBudget } : {}),
		})
			.then((map) => map.rendered)
			.catch(() => "");
	}
	return buildSkillPromptFragments(activeFragments, (fragmentId) => (fragmentId === "repo_map" ? repoMapText : null));
}
