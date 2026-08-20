/**
 * `dev oracle-grade` — the invocation wire for P23.5's held-out oracle.
 *
 * The oracle machinery (independence assessment, probe discovery, host-tsx dispatch) shipped and is tested,
 * but nothing outside its own tests ever called `runHeldOutOracle` — so the item's remaining leg ("run a
 * longer/decomposed real-model attempt and grade it") had no way to execute at all. This command is that
 * wire, deliberately thin: every decision stays in the core, and the command only resolves paths and prints.
 *
 * Grading happens AFTER the agent finishes, against a workspace the agent could write to but probes it could
 * never reach — the independence check runs FIRST and fail-closed, so a workspace that can touch the probes
 * grades nothing rather than grading itself.
 */

import { resolve } from "node:path";
import { listHeldOutProbes, runHeldOutOracle } from "../core/held-out-oracle-runner";

export interface DevHeldOutOracleOptions {
	/** The workspace under grade — the agent's writable root. */
	workspace: string;
	/** Probe directory; defaults to `test/protected/oracle/<project>` under the repo root. */
	project?: string;
	probeDir?: string;
	/** The graded project's own acceptance command, so the independence check can refuse it as a runner. */
	acceptanceCommand?: string;
	json?: boolean;
	repoRoot?: string;
}

export async function runDevHeldOutOracleCommand(
	options: DevHeldOutOracleOptions,
	write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const probeDir = options.probeDir
		? resolve(options.probeDir)
		: options.project
			? resolve(repoRoot, "test/protected/oracle", options.project)
			: null;
	if (!probeDir) {
		write("error: pass --project <id> or --probe-dir <path>.");
		return 64;
	}
	const workspacePath = resolve(options.workspace);
	const probes = await listHeldOutProbes(probeDir);
	const verdict = await runHeldOutOracle({
		workspacePath,
		probeDir,
		repoRoot,
		...(options.acceptanceCommand ? { projectAcceptanceCommand: options.acceptanceCommand } : {}),
	});

	if (options.json) {
		write(JSON.stringify({ probeDir, workspacePath, probes: probes.length, verdict }, null, 2));
	} else {
		write(`Held-out oracle: ${probes.length} probe(s) in ${probeDir}`);
		write(`  independence: ${verdict.independence.independent ? "INDEPENDENT ✓" : "NOT INDEPENDENT ✗"}`);
		if (!verdict.independence.independent) {
			// The reason matters more than the verdict: a non-independent oracle is a configuration bug, not
			// a statement about the agent's work.
			write(`  reason: ${verdict.independence.reason}`);
			write("  Nothing was graded — an oracle the workspace can reach cannot judge it.");
		} else {
			write(`  fail_to_pass: ${verdict.failToPassPassed}/${verdict.failToPassTotal}`);
			write(`  delivered: ${verdict.delivered}`);
			for (const result of verdict.results) {
				write(`    ${result.passed ? "pass" : "FAIL"}  ${result.probe.id}`);
			}
		}
	}
	// Exit code carries the DELIVERY claim, so a harness can gate on it. A non-independent oracle is a
	// distinct failure (65) from graded-but-not-delivered (1) — conflating them would let a misconfigured
	// run read as an honest negative result.
	if (!verdict.independence.independent) {
		return 65;
	}
	return verdict.delivered ? 0 : 1;
}
