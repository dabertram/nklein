/**
 * P1.SELFGRADED — the git side of the frozen-evidence guard: what a task's BASE commit declares frozen, and what the
 * DELIVERED commit changed, read straight from the host repository. The decision is the pure
 * `core/frozen-evidence-guard.ts`; the wiring is the acceptance verifier.
 *
 * Every read goes through `runGit` (sanitised git environment) against the project repository on the host — never the
 * sandbox, whose contents are the thing under suspicion.
 */

import {
	FROZEN_MANIFEST_PATHS,
	type FrozenEvidenceViolation,
	type FrozenManifestSource,
	findFrozenEvidenceViolations,
	parseNameStatusZ,
	resolveFrozenPaths,
} from "../core/frozen-evidence-guard";
import { runGit } from "./git-utils";

export type FrozenEvidenceProbe =
	/** The base declares no manifest: the project never claimed a frozen set, so there is nothing to hold it to. */
	| { readonly status: "no_manifest" }
	| {
			readonly status: "checked";
			readonly manifests: readonly string[];
			readonly frozenPathCount: number;
			readonly violations: readonly FrozenEvidenceViolation[];
	  }
	/** A git read failed. The probe never guesses a verdict; the caller decides what an unreadable repository means. */
	| { readonly status: "unavailable"; readonly reason: string };

export interface ProbeFrozenEvidenceInput {
	readonly repoPath: string;
	/** The task's base — the commit (or branch) the delivery left from. */
	readonly baseRef: string;
	/** The delivered commit acceptance would otherwise run against. */
	readonly resultCommit: string;
}

export async function probeFrozenEvidence(input: ProbeFrozenEvidenceInput): Promise<FrozenEvidenceProbe> {
	for (const ref of [input.baseRef, input.resultCommit]) {
		// Option-injection family (audit 2026-08-25): a ref git would parse as an option is refused outright. Every
		// git argument below is a ref or a ref-qualified path, so this one check covers all of them.
		if (ref.trim().length === 0 || ref.startsWith("-")) {
			return { status: "unavailable", reason: `refusing an unsafe git ref: ${JSON.stringify(ref)}` };
		}
	}

	const listed = await runGit(input.repoPath, [
		"ls-tree",
		"-r",
		"--name-only",
		input.baseRef,
		"--",
		...FROZEN_MANIFEST_PATHS,
	]);
	if (!listed.ok) {
		return { status: "unavailable", reason: listed.error ?? "git ls-tree failed" };
	}
	const present = new Set(listed.stdout.split("\n").map((line) => line.trim()));
	const manifestPaths = FROZEN_MANIFEST_PATHS.filter((path) => present.has(path));
	if (manifestPaths.length === 0) {
		return { status: "no_manifest" };
	}

	const manifests: FrozenManifestSource[] = [];
	for (const path of manifestPaths) {
		const shown = await runGit(input.repoPath, ["show", `${input.baseRef}:${path}`], { trimStdout: false });
		if (!shown.ok) {
			return { status: "unavailable", reason: shown.error ?? `git show ${path} failed` };
		}
		manifests.push({ path, text: shown.stdout });
	}
	const frozen = resolveFrozenPaths(manifests);

	// Three dots: what the DELIVERY changed since it left its base, not every difference between the two tips — a base
	// branch that moved on after the task started must not be charged to the task.
	const diff = await runGit(
		input.repoPath,
		["diff", "--name-status", "--no-renames", "-z", `${input.baseRef}...${input.resultCommit}`, "--"],
		{ trimStdout: false },
	);
	if (!diff.ok) {
		return { status: "unavailable", reason: diff.error ?? "git diff failed" };
	}
	return {
		status: "checked",
		manifests: manifestPaths,
		frozenPathCount: frozen.size,
		violations: findFrozenEvidenceViolations({ frozen, changes: parseNameStatusZ(diff.stdout) }),
	};
}
