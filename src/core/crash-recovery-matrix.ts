/**
 * N10 — deterministic crash barriers and their fail-closed evidence oracle.
 *
 * The barrier is inert unless BOTH opt-in environment variables are present. In a matrix run the first runtime
 * reaching the selected phase writes a durable marker and waits. The harness SIGKILLs that process; the restarted
 * runtime sees the marker and passes the same seam exactly once. This creates a reproducible kill boundary without
 * adding timing sleeps to production behavior.
 */

import { access, mkdir, open, realpath, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export const CRASH_RECOVERY_MATRIX_PHASES = [
	"decompose",
	"worker",
	"review",
	"delivery",
	"compaction",
	"trigger",
] as const;

export type CrashRecoveryMatrixPhase = (typeof CRASH_RECOVERY_MATRIX_PHASES)[number];

export interface CrashRecoveryMatrixPhaseEvidence {
	phase: CrashRecoveryMatrixPhase;
	markerCount: number;
	killSignal: string | null;
	restartCount: number;
	stuckCardIds: string[];
	duplicateSideEffectIds: string[];
	orphanLeaseIds: string[];
	orphanWorktreePaths: string[];
	orphanSessionIds: string[];
}

export interface CrashRecoveryMatrixVerdict {
	ok: boolean;
	issues: string[];
}

function fileExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

export function isCrashRecoveryMatrixPhaseEnabled(phase: CrashRecoveryMatrixPhase): boolean {
	return process.env.NKLEIN_CRASH_RECOVERY_MATRIX === "1" && process.env.NKLEIN_CRASH_RECOVERY_PHASE === phase;
}

async function resolveConfinedControlDirectory(): Promise<string> {
	const configured = process.env.NKLEIN_CRASH_RECOVERY_CONTROL_DIR?.trim();
	if (!configured || !isAbsolute(configured)) {
		throw new Error("NKLEIN_CRASH_RECOVERY_CONTROL_DIR must be an absolute path inside the isolated HOME.");
	}
	// Node's `homedir()` may resolve the passwd database rather than a test/runtime HOME override on macOS. The
	// runtime itself is intentionally launched with an isolated HOME, so confinement must use that same source.
	const home = resolve(process.env.HOME?.trim() || homedir());
	const lexicalRelative = relative(home, resolve(configured));
	if (
		!lexicalRelative ||
		lexicalRelative === ".." ||
		lexicalRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(lexicalRelative)
	) {
		throw new Error("Crash-recovery control directory must be a child of the isolated HOME.");
	}
	await mkdir(configured, { recursive: true, mode: 0o700 });
	const [realHome, realControl] = await Promise.all([realpath(home), realpath(configured)]);
	const physicalRelative = relative(realHome, realControl);
	if (
		!physicalRelative ||
		physicalRelative === ".." ||
		physicalRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(physicalRelative)
	) {
		throw new Error("Crash-recovery control directory resolves outside the isolated HOME.");
	}
	return realControl;
}

/**
 * Arm one durable crash seam. The harness must SIGKILL after `<phase>.reached.json` appears. A `<phase>.release`
 * file is an emergency/manual escape hatch; the standing matrix never uses it because that would not prove recovery.
 */
export async function reachCrashRecoveryMatrixBarrier(
	phase: CrashRecoveryMatrixPhase,
	detail: Record<string, string | number | boolean | null> = {},
): Promise<void> {
	if (!isCrashRecoveryMatrixPhaseEnabled(phase)) {
		return;
	}
	const controlDirectory = await resolveConfinedControlDirectory();
	const markerPath = join(controlDirectory, `${phase}.reached.json`);
	if (await fileExists(markerPath)) {
		return;
	}
	const claimPath = join(controlDirectory, `${phase}.claim`);
	try {
		await mkdir(claimPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return;
		}
		throw error;
	}
	const temporaryPath = join(controlDirectory, `${phase}.reached.${process.pid}.tmp`);
	const marker = {
		schemaVersion: 1,
		phase,
		pid: process.pid,
		reachedAt: new Date().toISOString(),
		detail,
	};
	const handle = await open(temporaryPath, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(marker)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporaryPath, markerPath);

	const releasePath = join(controlDirectory, `${phase}.release`);
	while (!(await fileExists(releasePath))) {
		await new Promise<void>((settle) => setTimeout(settle, 25));
	}
}

export function evaluateCrashRecoveryPhaseEvidence(
	evidence: CrashRecoveryMatrixPhaseEvidence,
): CrashRecoveryMatrixVerdict {
	const issues: string[] = [];
	if (evidence.markerCount !== 1)
		issues.push(`${evidence.phase}: expected one durable barrier marker, saw ${evidence.markerCount}`);
	if (evidence.killSignal !== "SIGKILL")
		issues.push(`${evidence.phase}: expected SIGKILL, saw ${evidence.killSignal ?? "none"}`);
	if (evidence.restartCount !== 1)
		issues.push(`${evidence.phase}: expected one runtime restart, saw ${evidence.restartCount}`);
	for (const [label, values] of [
		["stuck cards", evidence.stuckCardIds],
		["duplicate side effects", evidence.duplicateSideEffectIds],
		["orphan leases", evidence.orphanLeaseIds],
		["orphan worktrees", evidence.orphanWorktreePaths],
		["orphan sessions", evidence.orphanSessionIds],
	] as const) {
		if (values.length > 0) issues.push(`${evidence.phase}: ${label}: ${values.join(", ")}`);
	}
	return { ok: issues.length === 0, issues };
}

export function evaluateCrashRecoveryMatrixEvidence(
	evidence: CrashRecoveryMatrixPhaseEvidence[],
): CrashRecoveryMatrixVerdict {
	const issues: string[] = [];
	for (const phase of CRASH_RECOVERY_MATRIX_PHASES) {
		const matching = evidence.filter((entry) => entry.phase === phase);
		if (matching.length !== 1) {
			issues.push(`${phase}: expected one phase receipt, saw ${matching.length}`);
			continue;
		}
		issues.push(...evaluateCrashRecoveryPhaseEvidence(matching[0] as CrashRecoveryMatrixPhaseEvidence).issues);
	}
	return { ok: issues.length === 0, issues };
}
