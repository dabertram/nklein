/**
 * §5.AK — the richer, work-package-shaped CARD schema (pure). Decompose should emit cards that carry their contract
 * bounds, so a small-model worker stays in-bounds BY CONSTRUCTION: a write-scope (globs it may touch), forbidden paths
 * (globs it must not — the Red files + docs), the interfaces it must honor (signatures/types/endpoints it may not
 * break), and the acceptance shape (how completion is verified + explicit non-goals). This is the schema + the pure
 * projection to the existing {@link ./work-package-dispatch.WorkPackage} the overlap classifier already consumes; the
 * decompose logic that POPULATES these bounds is the next leaf. Pure schema + total helpers.
 */

import { z } from "zod";
import type { WorkPackage } from "./work-package-dispatch.js";

/** An interface contract the card must honor — a symbol/endpoint whose shape it may not break. */
export const cardInterfaceSchema = z.object({
	/** The qualified name / endpoint / event the card must keep working. */
	name: z.string(),
	kind: z.enum(["function", "type", "endpoint", "event", "cli"]).default("function"),
	/** When true, the card must NOT change this interface's shape (a hard contract, not just a touch-point). */
	frozen: z.boolean().default(true),
});
export type CardInterface = z.infer<typeof cardInterfaceSchema>;

/** How the card's completion is verified — the acceptance shape. */
export const cardAcceptanceSchema = z.object({
	/** Human-readable acceptance checks the result must satisfy. */
	checks: z.array(z.string()).default([]),
	/** A command whose success == acceptance (e.g. a test command), or null when acceptance is check-only. */
	command: z.string().nullable().default(null),
	/** Explicit non-goals — out of scope, must NOT be done. */
	nonGoals: z.array(z.string()).default([]),
});
export type CardAcceptance = z.infer<typeof cardAcceptanceSchema>;

/** A richer work-package-shaped card carrying its §5.AK contract bounds. */
export const richerCardSpecSchema = z.object({
	id: z.string(),
	objective: z.string(),
	/** Path globs the card MAY write. */
	writeScope: z.array(z.string()).default([]),
	/** Path globs the card must NOT touch (Red files + docs). */
	forbiddenPaths: z.array(z.string()).default([]),
	/** Interface contracts the card must honor. */
	interfaces: z.array(cardInterfaceSchema).default([]),
	/** How completion is verified. */
	acceptance: cardAcceptanceSchema.default({ checks: [], command: null, nonGoals: [] }),
	/** Prerequisite card ids whose outputs this card consumes. */
	dependsOn: z.array(z.string()).default([]),
});
export type RicherCardSpec = z.infer<typeof richerCardSpecSchema>;

/**
 * Project a richer card spec down to the {@link WorkPackage} the overlap classifier (`classifyPackagePairConflict`)
 * consumes: the write-scope + forbidden paths + dependencies become the dispatch bounds. Pure — the interfaces +
 * acceptance shape are the card's own contract and don't affect pairwise write-conflict classification.
 */
export function richerCardToWorkPackage(spec: RicherCardSpec): WorkPackage {
	return {
		id: spec.id,
		writeScope: spec.writeScope,
		...(spec.forbiddenPaths.length > 0 ? { forbiddenScope: spec.forbiddenPaths } : {}),
		...(spec.dependsOn.length > 0 ? { dependsOn: spec.dependsOn } : {}),
	};
}
