/**
 * Step-plan persistence — one JSON document per card under the runtime's diagnostic root:
 *   step-plans/<workspace-hash>/<cardId>.json
 * Atomic write (temp + rename) so a crash mid-write never leaves a torn plan; a plan that fails schema validation on
 * read is reported as absent (the stage re-plans rather than executing a document it cannot trust). The controller
 * owns the in-memory plan; the store is the durable copy a restart, an operator, or an audit reads.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type StepPlan, stepPlanSchema } from "../core/step-plan";

export interface StepPlanStore {
	read(workspaceHash: string, cardId: string): Promise<StepPlan | null>;
	write(workspaceHash: string, plan: StepPlan): Promise<void>;
	pathFor(workspaceHash: string, cardId: string): string;
}

function safeFileName(cardId: string): string {
	return cardId.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function createStepPlanStore(rootDir: string): StepPlanStore {
	const baseDir = join(rootDir, "step-plans");
	function pathFor(workspaceHash: string, cardId: string): string {
		return join(baseDir, workspaceHash, `${safeFileName(cardId)}.json`);
	}
	return {
		pathFor,
		async read(workspaceHash, cardId) {
			try {
				const parsed = stepPlanSchema.safeParse(JSON.parse(await readFile(pathFor(workspaceHash, cardId), "utf8")));
				return parsed.success ? parsed.data : null;
			} catch {
				return null;
			}
		},
		async write(workspaceHash, plan) {
			const path = pathFor(workspaceHash, plan.cardId);
			await mkdir(join(baseDir, workspaceHash), { recursive: true });
			const tmp = `${path}.${process.pid}-${Date.now().toString(36)}.tmp`;
			await writeFile(tmp, JSON.stringify(plan, null, 2), "utf8");
			await rename(tmp, path);
		},
	};
}
