/** N10 standing lane: six isolated real-runtime SIGKILL drains over deterministic aimock. */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CRASH_RECOVERY_MATRIX_PHASES,
	evaluateCrashRecoveryMatrixEvidence,
	type CrashRecoveryMatrixPhaseEvidence,
} from "../src/core/crash-recovery-matrix.js";

const keepHomes = process.env.NKLEIN_CRASH_MATRIX_KEEP_HOMES === "1";
const basePort = Number(process.env.NKLEIN_CRASH_MATRIX_BASE_PORT) || 4010;
const receipts: CrashRecoveryMatrixPhaseEvidence[] = [];

for (const [index, phase] of CRASH_RECOVERY_MATRIX_PHASES.entries()) {
	const home = await mkdtemp(join(tmpdir(), `nklein-verify-crash-matrix-${phase}-`));
	process.stderr.write(`== crash-recovery ${phase} (${index + 1}/${CRASH_RECOVERY_MATRIX_PHASES.length}) ==\n`);
	let output = "";
	const child = spawn("npx", ["tsx", "scripts/verify-simulated-flow.mts"], {
		env: {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			NKLEIN_SIMFLOW_CRASH_PHASE: phase,
			NKLEIN_SIMFLOW_RUNTIME_PORT: String(basePort + index),
			NKLEIN_SIMFLOW_TIMEOUT_MS: process.env.NKLEIN_SIMFLOW_TIMEOUT_MS ?? "480000",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		output += text;
		process.stdout.write(text);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		output += text;
		process.stderr.write(text);
	});
	const exitCode = await new Promise<number>((settle) => child.once("close", (code) => settle(code ?? 1)));
	const receiptLines = output
		.split(/\r?\n/)
		.filter((line) => line.startsWith("CRASH_RECOVERY_PHASE_EVIDENCE="));
	if (exitCode !== 0 || receiptLines.length !== 1) {
		throw new Error(
			`${phase} crash-recovery cell failed (exit ${exitCode}, ${receiptLines.length} receipt(s)); isolated HOME retained: ${home}`,
		);
	}
	const parsed = JSON.parse((receiptLines[0] ?? "").slice("CRASH_RECOVERY_PHASE_EVIDENCE=".length)) as {
		verdict?: { ok?: boolean; issues?: string[] };
	} & CrashRecoveryMatrixPhaseEvidence;
	if (parsed.phase !== phase || parsed.verdict?.ok !== true) {
		throw new Error(`${phase} emitted a non-green/mismatched receipt; isolated HOME retained: ${home}`);
	}
	receipts.push(parsed);
	if (!keepHomes) await rm(home, { recursive: true, force: true });
}

const verdict = evaluateCrashRecoveryMatrixEvidence(receipts);
console.log(`CRASH_RECOVERY_MATRIX_EVIDENCE=${JSON.stringify({ schemaVersion: 1, phases: receipts, verdict })}`);
if (!verdict.ok) {
	throw new Error(verdict.issues.join("; "));
}
console.log(`PASS ✓ crash-recovery matrix: ${receipts.length}/${CRASH_RECOVERY_MATRIX_PHASES.length} SIGKILL phases recovered cleanly.`);
