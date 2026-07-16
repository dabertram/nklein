import { isTruthyEnv } from "../core/env-flag";
import { distillProceduralSkill, type ProcedureDistillationInput } from "../core/procedural-skill-distillation.js";
import type { ProceduralSkill } from "../core/procedural-skill-record.js";
import { upsertProceduralSkill } from "../state/procedural-skill-store.js";

/**
 * F4.19 producer WIRE — distill a completed task into the ProceduralSkillBank (behind `NKLEIN_PROCEDURAL_SKILLS`, the
 * SAME opt-in flag the consumer [nklein-session-skill-fragments.ts] reads, so producer and consumer light up together).
 *
 * This is the effectful bridge between the pure {@link distillProceduralSkill} and the store: gate on the flag, distill,
 * upsert. Best-effort — a distillation/write failure must never break the caller's completion path (the caller should
 * `void … .catch()` it). The distilled record is a `candidate` (never `active`), so populating the bank from here can
 * NEVER push an unvalidated procedure into a live prompt — the lifecycle promotes it only on real helped/hurt evidence.
 *
 * CALL SITE: the DELIVERED seam — a card that PASSED review and was delivered (not the pre-review terminal-attempt
 * event, whose state is only `awaiting_review`). Distilling from review-passed work keeps candidate quality high; the
 * caller supplies the card title/objective, the worker's completed focus chain, and `succeeded: true`.
 */
export async function maybeDistillAndStoreProcedure(
	input: ProcedureDistillationInput,
	options: { rootDir?: string; enabled?: boolean } = {},
): Promise<ProceduralSkill | null> {
	const enabled = options.enabled ?? isTruthyEnv(process.env.NKLEIN_PROCEDURAL_SKILLS);
	if (!enabled) {
		return null;
	}
	const skill = distillProceduralSkill(input);
	if (!skill) {
		return null;
	}
	await upsertProceduralSkill(skill, options.rootDir ? { rootDir: options.rootDir } : {});
	return skill;
}
