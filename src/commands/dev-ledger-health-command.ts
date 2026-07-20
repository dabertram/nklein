/**
 * `nklein dev ledger-health` — is the agent ledger fragmented, and does THIS path read a real file? (F12.35b)
 *
 * Operationalises the one-time F12.35b investigation: `review_effort_scaling` recorded zero because the review
 * runner's workspace hash matched no ledger file. The same seam feeds F12.14, F12.81 and F3.7b, so a
 * fragmentation returns nothing for all of them silently. This checks it on demand.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { assessLedgerHealth, type LedgerFileStat } from "../core/ledger-health";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";

async function readFileStats(dir: string): Promise<LedgerFileStat[]> {
	const entries = await readdir(dir).catch(() => [] as string[]);
	const stats: LedgerFileStat[] = [];
	for (const name of entries.filter((n) => n.endsWith(".jsonl"))) {
		const text = await readFile(join(dir, name), "utf8").catch(() => "");
		const eventCount = text.split("\n").filter((line) => line.trim().length > 0).length;
		stats.push({ hash: name.replace(/\.jsonl$/, ""), eventCount });
	}
	return stats;
}

export async function runDevLedgerHealthCommand(options: { path?: string; json?: boolean }): Promise<void> {
	// The default ledger root (must match agent-attempt-ledger-store's DEFAULT_ROOT) or the env override.
	const root =
		process.env.NKLEIN_AGENT_LEDGER_ROOT?.trim() ||
		join(resolveNkleinRuntimeHomePath(homedir()), "agent-attempt-ledger");
	// The path a consumer here would hash — defaults to the current working directory, the review runner's case.
	const currentPath = options.path ?? process.cwd();

	const files = await readFileStats(root);
	const health = assessLedgerHealth({
		files,
		currentPathHash: hashWorkspacePathForLedger(currentPath),
		unknownHash: hashWorkspacePathForLedger(null),
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ root, currentPath, health }, null, 2)}\n`);
		// The current path reading an empty history is the actionable defect — fail a script on it.
		process.exitCode = health.currentPathMatchesNoFile ? 1 : 0;
		return;
	}

	process.stdout.write(`LEDGER HEALTH (${root})\n`);
	process.stdout.write(`  current path: ${currentPath}\n  → hash ${hashWorkspacePathForLedger(currentPath)}\n\n`);
	process.stdout.write(`${health.summary}\n`);
	process.exitCode = health.currentPathMatchesNoFile ? 1 : 0;
}
