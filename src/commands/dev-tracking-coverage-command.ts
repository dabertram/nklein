/**
 * `nklein dev tracking-coverage` — what does !Klein actually record about a card?
 *
 * N18. Answers David's requirement with something checkable instead of a claim: every `tracked` entry names an
 * `emitterToken` that must appear in the source, and this command verifies it. A renamed or deleted emitter
 * turns the table red rather than letting it go on promising coverage that no longer exists.
 *
 * It reads `src/` from disk for the same reason `dev requirement-coverage` had to exclude its own map: an audit
 * that checks a hand-written list against another hand-written list checks nothing.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CARD_TRACKING_CONTRACT, verifyTrackingCoverage } from "../core/card-tracking-coverage";

/**
 * Files EXCLUDED from the searched text, unconditionally.
 *
 * ⚠️ **THIS EXCLUSION IS THE WHOLE CHECK.** The contract file contains every `emitterToken` as a literal, so
 * reading it back makes each token match its own declaration and the audit passes no matter what. Caught by
 * planting a renamed token (`card_lane_change_RENAMED_BY_SOMEONE`): the command reported *"Every tracked claim
 * was verified against a real emitter"* and exited 0.
 *
 * That is the fourth self-contamination bug in this codebase in one day — see §4A. The error always points the
 * same way, toward "everything is fine", and the only reliable trigger is a result that looks BETTER than it
 * should. Unconditional, not per-caller: two commands once disagreed about the same codebase precisely because
 * one remembered to exclude and the other did not.
 */
const EXCLUDED_FROM_SEARCH = ["card-tracking-coverage.ts", "dev-tracking-coverage-command.ts"];

async function readAllSources(root: string): Promise<string> {
	const parts: string[] = [];
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (
				(entry.name.endsWith(".ts") || entry.name.endsWith(".mts")) &&
				!EXCLUDED_FROM_SEARCH.includes(entry.name)
			) {
				parts.push(await readFile(full, "utf8").catch(() => ""));
			}
		}
	}
	await walk(root);
	return parts.join("\n");
}

const STATUS_MARK: Record<string, string> = { tracked: "✓", partial: "~", untracked: "✗" };

export async function runDevTrackingCoverageCommand(options: { json?: boolean }): Promise<void> {
	// `scripts/` too: the drain emits `[review-phase]` and the hold line from there, not from `src/`.
	const sourceText = `${await readAllSources("src")}\n${await readAllSources("scripts")}`;
	const verification = verifyTrackingCoverage({ sourceText });

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ contract: CARD_TRACKING_CONTRACT, verification }, null, 2)}\n`);
		process.exitCode = verification.ok ? 0 : 1;
		return;
	}

	process.stdout.write("WHAT !KLEIN TRACKS ABOUT A CARD\n\n");
	for (const entry of CARD_TRACKING_CONTRACT) {
		process.stdout.write(`${STATUS_MARK[entry.status]} ${entry.id}  [${entry.source}]\n`);
		process.stdout.write(`    ${entry.what}\n`);
		if (entry.gap) {
			process.stdout.write(`    GAP: ${entry.gap}\n`);
		}
	}

	process.stdout.write(`\n${verification.summary}\n`);
	for (const broken of verification.brokenClaims) {
		process.stdout.write(`  BROKEN CLAIM: ${broken}\n`);
	}
	for (const uncheckable of verification.uncheckableClaims) {
		process.stdout.write(`  UNCHECKABLE (no emitter token): ${uncheckable}\n`);
	}
	for (const unexplained of verification.unexplainedGaps) {
		process.stdout.write(`  GAP WITH NO EXPLANATION: ${unexplained}\n`);
	}
	process.exitCode = verification.ok ? 0 : 1;
}
