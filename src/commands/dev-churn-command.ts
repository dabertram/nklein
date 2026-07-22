/**
 * `nklein dev churn --commit <sha>` — how much of a commit's work is still here?
 *
 * P20.10's argument, made runnable: every other quality signal measures a MOMENT. P20.1 now rejects board-only
 * state tampering, but a green acceptance run still cannot tell whether maintainers keep the work. Churn measures
 * that later reality — **what a human subsequently deleted or rewrote.**
 *
 * It is useful immediately rather than only after a 24h window: "how much of what this commit wrote is still in
 * the tree?" is answerable against any later ref, and the scheduled 24h/7d sampling is a refinement of the same
 * question rather than a precondition for asking it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildBlameArgs, type ChurnGitPort, collectChurnForCard, countAttributedLines } from "../core/churn-collector";
import { assessChurn } from "../core/post-acceptance-churn";

const execFileAsync = promisify(execFile);

/** Files a commit touched, with the lines it added — the denominator churn is measured against. */
async function readAuthoredFiles(commit: string): Promise<{ path: string; authoredLines: number }[]> {
	const { stdout } = await execFileAsync("git", ["show", "--numstat", "--format=", commit], {
		maxBuffer: 32 * 1024 * 1024,
	});
	return stdout
		.split("\n")
		.map((line) => line.split("\t"))
		.filter((parts) => parts.length === 3 && parts[0] !== "-")
		.map((parts) => ({ path: parts[2] as string, authoredLines: Number.parseInt(parts[0] as string, 10) || 0 }))
		.filter((file) => file.authoredLines > 0);
}

function createGitPort(): ChurnGitPort {
	return {
		countSurvivingLines: async ({ path, commit, ref }) => {
			try {
				const { stdout } = await execFileAsync("git", [...buildBlameArgs({ path, ref })], {
					maxBuffer: 64 * 1024 * 1024,
				});
				return countAttributedLines(stdout, commit);
			} catch {
				// A deleted or renamed file cannot be blamed. Returning null rather than 0 keeps "could not read"
				// distinct from "nothing survived" — the collector counts it as fully churned AND names it, which a
				// bare 0 would not.
				return null;
			}
		},
	};
}

export async function runDevChurnCommand(options: { commit?: string; ref?: string; json?: boolean }): Promise<void> {
	if (!options.commit) {
		process.stdout.write("usage: dev churn --commit <sha> [--ref HEAD]\n");
		process.exitCode = 2;
		return;
	}
	const ref = options.ref ?? "HEAD";

	const files = await readAuthoredFiles(options.commit).catch(() => null);
	if (files === null) {
		process.stdout.write(`Could not read commit ${options.commit}.\n`);
		process.exitCode = 1;
		return;
	}

	const collected = await collectChurnForCard({
		cardId: options.commit,
		commit: options.commit,
		laterRef: ref,
		files,
		git: createGitPort(),
	});

	// The collector counts; `assessChurn` judges. Both windows are passed the SAME figure here because a single
	// point-in-time read cannot distinguish "wrong on arrival" from "changed later" — the 24h/7d split needs two
	// samples, and pretending otherwise would manufacture an iteration gap that was never measured.
	const assessment = assessChurn({
		cardId: options.commit,
		authoredLines: collected.authoredLines,
		churnedWithin24h: collected.churnedLines,
		churnedWithin7d: collected.churnedLines,
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ collected, assessment }, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${collected.summary}\n`);
	process.stdout.write(`${assessment.verdict.toUpperCase()}: ${assessment.reason}\n`);
	process.stdout.write(
		"\nSINGLE SAMPLE: this reads survival at one moment, so the 24h/7d split is not available and the\n" +
			"iteration gap is reported as zero rather than estimated. A moved or reformatted line reads as churn, so\n" +
			"a LOW figure is trustworthy while a HIGH one deserves a look before it is believed.\n",
	);
}
