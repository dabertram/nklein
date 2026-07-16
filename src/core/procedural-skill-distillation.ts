/**
 * Procedural-skill DISTILLATION producer (F4.19) — turns a completed, successful task into a reusable procedure record.
 *
 * The ProceduralSkillBank had record + store + retrieval + a consumer wire, but NOTHING wrote procedures — the bank was
 * always empty. This is the missing PRODUCER: when a task succeeds and the worker followed a self-authored focus chain
 * (its plan-of-attack, §5.N), the completed steps ARE a candidate procedure ("how a task of this kind was actually done
 * successfully"). We distill those steps into a {@link ProceduralSkill} record so a future similar task can retrieve it.
 *
 * Conservative on purpose: distills ONLY successful tasks with a substantive completed plan (≥2 done steps), and every
 * distilled procedure starts as a `candidate` (createProceduralSkill's default) — NOT `active` — so it is NOT surfaced to
 * agents until the lifecycle promotes it on real helped/hurt evidence. So the producer can populate the bank freely
 * without the risk of pushing an unvalidated procedure into a live prompt. Deterministic (content hash + derived tags).
 */

import { createHash } from "node:crypto";
import { createProceduralSkill, type ProceduralSkill } from "./procedural-skill-record.js";
import { deriveProceduralContextTags } from "./procedural-skill-retrieval.js";

export interface ProcedureDistillationInput {
	/** The task the procedure was learned from (used for a stable id + provenance). */
	taskId: string;
	taskTitle: string;
	taskObjective: string;
	/** The worker's self-authored focus chain (its plan checklist), completed. Its `[x]` steps are the procedure body. */
	focusChain: string;
	/** Whether the task actually succeeded — only successful tasks are distilled. */
	succeeded: boolean;
	/** The worker role, folded into the applicability tags (via {@link deriveProceduralContextTags}). */
	role?: string | null;
	/** ms epoch, injected (the store stamps records; the core stays deterministic given `now`). */
	now: number;
}

/** A procedure needs at least this many completed steps to be worth distilling (a 1-step "plan" is not reusable). */
const MIN_COMPLETED_STEPS = 2;

/** Extract the completed (`- [x] …`) step texts from a focus chain, in order, trimmed + de-duplicated. */
export function extractCompletedSteps(focusChain: string): string[] {
	if (typeof focusChain !== "string" || focusChain.trim().length === 0) {
		return [];
	}
	const steps: string[] = [];
	const seen = new Set<string>();
	for (const line of focusChain.split("\n")) {
		const match = line.match(/^\s*[-*]?\s*\[[xX]\]\s+(.*\S)\s*$/);
		if (match) {
			const step = match[1].trim();
			if (step.length > 0 && !seen.has(step)) {
				seen.add(step);
				steps.push(step);
			}
		}
	}
	return steps;
}

/**
 * Distill a completed successful task into a candidate {@link ProceduralSkill}, or `null` when it isn't worth it (the
 * task failed, or its completed plan has fewer than {@link MIN_COMPLETED_STEPS} steps). The procedure body is the ordered
 * completed steps; applicability tags come from the role + task text; the id is stable per (task, content) so re-distilling
 * the same result is idempotent. The record starts as a `candidate` — never surfaced until the lifecycle promotes it.
 */
export function distillProceduralSkill(input: ProcedureDistillationInput): ProceduralSkill | null {
	if (!input.succeeded) {
		return null;
	}
	const steps = extractCompletedSteps(input.focusChain);
	if (steps.length < MIN_COMPLETED_STEPS) {
		return null;
	}
	const content = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
	const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
	const id = `proc-${createHash("sha256").update(`${input.taskId}|${contentHash}`).digest("hex").slice(0, 12)}`;
	const title = input.taskTitle.trim().slice(0, 120) || "Untitled procedure";
	const applicabilityTags = deriveProceduralContextTags(input.role, `${input.taskTitle} ${input.taskObjective}`);
	return createProceduralSkill({
		id,
		title,
		content,
		contentHash,
		applicabilityTags,
		provenance: { source: `learned:${input.taskId}`, trust: "workspace", capturedAt: input.now },
		now: input.now,
	});
}
