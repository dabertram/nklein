import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProcedureDistillationInput } from "../../../src/core/procedural-skill-distillation";
import { maybeDistillAndStoreProcedure } from "../../../src/nklein-agent/procedural-skill-producer";
import { getCurrentProceduralSkills } from "../../../src/state/procedural-skill-store";

const input: ProcedureDistillationInput = {
	taskId: "task-1",
	taskTitle: "Add login",
	taskObjective: "Implement email/password login",
	focusChain: "- [x] Write the handler\n- [x] Add validation\n- [x] Write tests",
	succeeded: true,
	role: "coder",
	now: 1000,
};

describe("maybeDistillAndStoreProcedure (F4.19 producer wire)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "nklein-proc-prod-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("distills + stores a candidate procedure when explicitly enabled", async () => {
		const skill = await maybeDistillAndStoreProcedure(input, { rootDir: root, enabled: true });
		expect(skill).not.toBeNull();
		expect(skill?.status).toBe("candidate");
		const stored = await getCurrentProceduralSkills({ rootDir: root });
		expect(stored.map((s) => s.id)).toContain(skill?.id);
	});

	it("is a no-op (stores nothing) when disabled", async () => {
		expect(await maybeDistillAndStoreProcedure(input, { rootDir: root, enabled: false })).toBeNull();
		expect(await getCurrentProceduralSkills({ rootDir: root })).toEqual([]);
	});

	it("stores nothing for a task that did not succeed", async () => {
		expect(
			await maybeDistillAndStoreProcedure({ ...input, succeeded: false }, { rootDir: root, enabled: true }),
		).toBeNull();
		expect(await getCurrentProceduralSkills({ rootDir: root })).toEqual([]);
	});

	it("re-distilling the same result is idempotent (upsert by stable id)", async () => {
		await maybeDistillAndStoreProcedure(input, { rootDir: root, enabled: true });
		await maybeDistillAndStoreProcedure({ ...input, now: 2000 }, { rootDir: root, enabled: true });
		expect(await getCurrentProceduralSkills({ rootDir: root })).toHaveLength(1);
	});
});
