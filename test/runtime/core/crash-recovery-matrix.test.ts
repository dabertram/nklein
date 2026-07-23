import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CRASH_RECOVERY_MATRIX_PHASES,
	type CrashRecoveryMatrixPhaseEvidence,
	evaluateCrashRecoveryMatrixEvidence,
	evaluateCrashRecoveryPhaseEvidence,
	isCrashRecoveryMatrixPhaseEnabled,
	reachCrashRecoveryMatrixBarrier,
} from "../../../src/core/crash-recovery-matrix";

const ORIGINAL_ENV = { ...process.env };
const temporaryHomes: string[] = [];

afterEach(async () => {
	process.env = { ...ORIGINAL_ENV };
	await Promise.all(temporaryHomes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function healthy(phase: CrashRecoveryMatrixPhaseEvidence["phase"]): CrashRecoveryMatrixPhaseEvidence {
	return {
		phase,
		markerCount: 1,
		killSignal: "SIGKILL",
		restartCount: 1,
		stuckCardIds: [],
		duplicateSideEffectIds: [],
		orphanLeaseIds: [],
		orphanWorktreePaths: [],
		orphanSessionIds: [],
	};
}

describe("crash-recovery matrix", () => {
	it("is completely inert unless the exact phase and explicit matrix opt-in match", () => {
		process.env.NKLEIN_CRASH_RECOVERY_MATRIX = "1";
		process.env.NKLEIN_CRASH_RECOVERY_PHASE = "review";
		expect(isCrashRecoveryMatrixPhaseEnabled("review")).toBe(true);
		expect(isCrashRecoveryMatrixPhaseEnabled("worker")).toBe(false);
		delete process.env.NKLEIN_CRASH_RECOVERY_MATRIX;
		expect(isCrashRecoveryMatrixPhaseEnabled("review")).toBe(false);
	});

	it("writes one durable marker, releases deterministically, and passes through on restart", async () => {
		const home = await mkdtemp(join(tmpdir(), "nklein-verify-crash-matrix-"));
		temporaryHomes.push(home);
		const control = join(home, ".nklein", "nklein", "crash-recovery-matrix");
		await mkdir(control, { recursive: true });
		process.env.HOME = home;
		process.env.NKLEIN_CRASH_RECOVERY_MATRIX = "1";
		process.env.NKLEIN_CRASH_RECOVERY_PHASE = "worker";
		process.env.NKLEIN_CRASH_RECOVERY_CONTROL_DIR = control;
		await writeFile(join(control, "worker.release"), "manual-test-release\n");

		await reachCrashRecoveryMatrixBarrier("worker", { taskId: "card-a", tool: "write_files" });
		const marker = JSON.parse(await readFile(join(control, "worker.reached.json"), "utf8"));
		expect(marker).toMatchObject({ schemaVersion: 1, phase: "worker", detail: { taskId: "card-a" } });
		await reachCrashRecoveryMatrixBarrier("worker", { taskId: "must-not-overwrite" });
		const unchanged = JSON.parse(await readFile(join(control, "worker.reached.json"), "utf8"));
		expect(unchanged.detail.taskId).toBe("card-a");
	});

	it("rejects a control path outside the isolated HOME", async () => {
		const home = await mkdtemp(join(tmpdir(), "nklein-verify-crash-matrix-"));
		const outside = await mkdtemp(join(tmpdir(), "nklein-crash-matrix-outside-"));
		temporaryHomes.push(home, outside);
		process.env.HOME = home;
		process.env.NKLEIN_CRASH_RECOVERY_MATRIX = "1";
		process.env.NKLEIN_CRASH_RECOVERY_PHASE = "trigger";
		process.env.NKLEIN_CRASH_RECOVERY_CONTROL_DIR = outside;
		await expect(reachCrashRecoveryMatrixBarrier("trigger")).rejects.toThrow("isolated HOME");
	});

	it("fails closed on every missing kill/restart and residual resource class", () => {
		const broken = healthy("delivery");
		broken.markerCount = 0;
		broken.killSignal = "SIGTERM";
		broken.restartCount = 2;
		broken.stuckCardIds = ["card-a"];
		broken.duplicateSideEffectIds = ["merge:card-a"];
		broken.orphanLeaseIds = ["lease-a"];
		broken.orphanWorktreePaths = ["/tmp/wt-a"];
		broken.orphanSessionIds = ["session-a"];
		const verdict = evaluateCrashRecoveryPhaseEvidence(broken);
		expect(verdict.ok).toBe(false);
		expect(verdict.issues).toHaveLength(8);
	});

	it("requires exactly one green receipt for every declared phase", () => {
		const complete = CRASH_RECOVERY_MATRIX_PHASES.map(healthy);
		expect(evaluateCrashRecoveryMatrixEvidence(complete)).toEqual({ ok: true, issues: [] });
		const incomplete = complete.filter((entry) => entry.phase !== "compaction");
		expect(evaluateCrashRecoveryMatrixEvidence(incomplete)).toMatchObject({ ok: false });
	});
});
