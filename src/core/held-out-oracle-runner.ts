/**
 * P23.5 — the held-out oracle EXECUTOR: run authored probe files against a drained workspace and return a
 * per-probe verdict. Composes the two existing guarantees rather than restating them:
 *
 *  - `assessOracleIndependence` runs FIRST and fail-closed — probes inside the agent's writable root, or a
 *    runner that dispatches through an agent-authored file, refuse to grade at all.
 *  - the runner is the HOST repo's own tsx binary invoking `node --test` on absolute probe paths — no npm, no
 *    workspace config, nothing the agent authored is on the dispatch path. The workspace under grade reaches
 *    probes ONLY via NKLEIN_ORACLE_WORKSPACE (probes import the spec-prescribed modules from it; executing
 *    agent code is the point of grading — owning the VERDICT machinery is what independence forbids).
 *
 * The NULL-AGENT gate (P20.1) falls out of the same function: run it against a workspace the agent never
 * touched — every fail_to_pass probe must FAIL. An oracle that scores above zero there is forgeable.
 */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { assessOracleIndependence, type HeldOutProbe, type OracleIndependenceAssessment } from "./held-out-oracle";

const execFileAsync = promisify(execFile);

export interface HeldOutProbeResult {
	readonly probe: HeldOutProbe;
	readonly passed: boolean;
	readonly outputTail: string;
}

export interface HeldOutOracleRunVerdict {
	readonly independence: OracleIndependenceAssessment;
	/** Present only when independence held — a non-independent oracle grades nothing. */
	readonly results: readonly HeldOutProbeResult[];
	readonly failToPassPassed: number;
	readonly failToPassTotal: number;
	/** True when every fail_to_pass probe passed (the delivered-behaviour claim). */
	readonly delivered: boolean;
}

/** Discover the authored probe files for a project (test/protected/oracle/<project>/*.probe.mts). */
export async function listHeldOutProbes(probeDir: string): Promise<HeldOutProbe[]> {
	// Absolute by construction: a RELATIVE probe path would be resolved against whatever root the
	// containment check compares it to — the independence verdict must never depend on the caller's cwd.
	const absoluteDir = resolve(probeDir);
	const entries = await readdir(absoluteDir).catch(() => []);
	return entries
		.filter((name) => name.endsWith(".probe.mts"))
		.sort()
		.map((name) => ({
			id: name.replace(/\.probe\.mts$/u, ""),
			kind: "fail_to_pass" as const,
			sourcePath: join(absoluteDir, name),
		}));
}

export interface RunHeldOutOracleInput {
	/** The workspace under grade (the agent's writable root). */
	readonly workspacePath: string;
	/** Directory holding the authored probes (inside !Klein's human-gated test/protected/oracle/...). */
	readonly probeDir: string;
	/** !Klein's repo root — supplies the tsx binary so the dispatch path is never agent-authored. */
	readonly repoRoot: string;
	/** The project's own acceptance command, for the independence check's refusal list. */
	readonly projectAcceptanceCommand?: string;
}

export async function runHeldOutOracle(
	input: RunHeldOutOracleInput,
	deps: {
		readonly exec: (
			command: string,
			args: readonly string[],
			env: Readonly<Record<string, string>>,
		) => Promise<{ ok: boolean; output: string }>;
	} = {
		exec: async (command, args, env) => {
			try {
				const { stdout, stderr } = await execFileAsync(command, [...args], {
					env: { ...process.env, ...env },
					maxBuffer: 16 * 1024 * 1024,
				});
				return { ok: true, output: `${stdout}\n${stderr}` };
			} catch (error) {
				const failed = error as { stdout?: string; stderr?: string; message?: string };
				return { ok: false, output: `${failed.stdout ?? ""}\n${failed.stderr ?? failed.message ?? ""}` };
			}
		},
	},
): Promise<HeldOutOracleRunVerdict> {
	const probes = await listHeldOutProbes(input.probeDir);
	const runner = [join(input.repoRoot, "node_modules", ".bin", "tsx"), "--test"];
	const independence = assessOracleIndependence({
		probes,
		agentWritableRoots: [resolve(input.workspacePath)],
		runner,
		// The refusal list needs SOME acceptance command to compare against; every dev-test project declares
		// `npm test`, so that is the honest default when the caller has nothing more specific.
		projectAcceptanceCommand: input.projectAcceptanceCommand ?? "npm test",
	});
	if (!independence.independent) {
		return { independence, results: [], failToPassPassed: 0, failToPassTotal: 0, delivered: false };
	}
	const results: HeldOutProbeResult[] = [];
	for (const probe of probes) {
		const { ok, output } = await deps.exec(runner[0] as string, ["--test", probe.sourcePath], {
			NKLEIN_ORACLE_WORKSPACE: input.workspacePath,
		});
		results.push({ probe, passed: ok, outputTail: output.slice(-1_500) });
	}
	const failToPass = results.filter((result) => result.probe.kind === "fail_to_pass");
	const failToPassPassed = failToPass.filter((result) => result.passed).length;
	return {
		independence,
		results,
		failToPassPassed,
		failToPassTotal: failToPass.length,
		delivered: failToPass.length > 0 && failToPassPassed === failToPass.length,
	};
}
