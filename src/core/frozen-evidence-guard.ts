/**
 * P1.SELFGRADED — the FROZEN-EVIDENCE GUARD: a delivery may not change what its base commit declares frozen. PURE
 * core; the git reads live in `workspace/frozen-evidence-probe.ts` and the wiring in the acceptance verifier.
 *
 * ── THE MEASURED DEFECT THIS EXISTS TO CLOSE ──
 * Every dev-test contract fixture is graded by `npm test` run INSIDE the agent's workspace, against a verifier, a
 * frozen-digest guard and a runner that all live in that same workspace. The in-tree guards catch an agent that
 * edits the evidence and leaves the guard alone; nothing in the tree can catch one that rewrites the guard.
 * Proven 2026-09-14: with each fixture's test files swapped for same-named no-ops, 42 of 42 fixtures ran green,
 * with the evidence doctored underneath (analysis-a1, spec-s4). The only anchor outside the workspace was a
 * responder brief telling reviewers to diff the frozen paths by hand.
 *
 * ── WHY THE BASE COMMIT IS A HELD-OUT ANCHOR ──
 * {@link ./held-out-oracle} states the constraint: whatever grades the work must live outside every root the agent
 * can write, and be applied at scoring time. The task's base commit meets it for free — the runtime recorded it
 * before the agent started, and git objects are content-addressed, so nothing the agent does can change what that
 * commit declares. So the guard reads the frozen manifest AT THE BASE and checks the delivered commit's changes
 * against it, host-side, before any acceptance command runs.
 *
 * Once the guard, the verifier and the runner are known to be untouched, the in-tree guard is trustworthy again —
 * and it catches the one thing a manifest cannot list: a file ADDED under a frozen directory.
 *
 * ── WHAT ELSE IS FROZEN, AND WHY ──
 *  · The manifest itself. Its base copy is the anchor, not the workspace's, which closes the hole
 *    P2.FIXTUREINTEGRITY recorded as "circular by nature".
 *  · `package.json` and `scripts/run-tests.mjs`, whenever a manifest exists: `npm test` dispatches through both,
 *    and any indirection through an agent-authored file is agent-controlled.
 *
 * ── WHAT IT DOES NOT CLOSE ──
 * Several families execute the agent's DELIVERABLE inside the grader (repair, refactor, integration, performance,
 * test authoring), so a deliverable written to subvert its own grader in-process is beyond any file-level check.
 * That is the residual held-out-oracle.ts already names, and this guard does not pretend otherwise.
 */

/** Where a fixture declares its frozen set. `frozen.json` nests the map under `frozen`; `frozen-digests.json` is flat. */
export const FROZEN_MANIFEST_PATHS: readonly string[] = ["test/frozen.json", "test/frozen-digests.json"];

/** The files `npm test` dispatches through — frozen whenever the base declares any manifest. */
export const FROZEN_DISPATCH_PATHS: readonly string[] = ["package.json", "scripts/run-tests.mjs"];

export type FrozenPathChange = "added" | "modified" | "deleted" | "type_changed";

export interface FrozenEvidenceViolation {
	readonly path: string;
	readonly change: FrozenPathChange;
}

export interface FrozenManifestSource {
	/** Repository-relative manifest path, as found on the base commit. */
	readonly path: string;
	readonly text: string;
}

export interface NameStatusEntry {
	/** git's status letter: `A`, `M`, `D`, `T`, … */
	readonly status: string;
	readonly path: string;
}

export interface FrozenEvidenceRefusal {
	/** What moved and why the delivery is refused — stands in for the acceptance output. */
	readonly output: string;
	/** The way back, for the repair prompt and the reviewer. */
	readonly hint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The paths a manifest declares frozen, or null when the text is not a manifest. Digests are not inspected: WHICH
 * files are frozen is the manifest's claim, and whether their bytes still match is the in-tree guard's job.
 *
 * A manifest may carry sibling maps for other purposes — repair's `src` records the shipped defective sources, which
 * are the work, not the evidence — so a nested `frozen` map is read on its own whenever it is present.
 */
export function parseFrozenManifestPaths(text: string): string[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) {
		return null;
	}
	const map = isRecord(parsed.frozen) ? parsed.frozen : parsed;
	const paths = Object.keys(map)
		.filter((key) => typeof map[key] === "string")
		.sort();
	return paths.length > 0 ? paths : null;
}

/**
 * Everything the base declares frozen: each manifest's paths, the manifests themselves, and the `npm test` dispatch
 * files. Empty when the base declares no manifest — a project that never made the claim has nothing to hold to it.
 *
 * An unreadable manifest still freezes itself and the dispatch files. A fixture that ships a manifest has claimed to
 * be frozen, and a manifest the guard cannot read must not become the way to un-freeze it.
 */
export function resolveFrozenPaths(manifests: readonly FrozenManifestSource[]): ReadonlySet<string> {
	const frozen = new Set<string>();
	for (const manifest of manifests) {
		frozen.add(manifest.path);
		for (const path of parseFrozenManifestPaths(manifest.text) ?? []) {
			frozen.add(path);
		}
	}
	if (frozen.size > 0) {
		for (const path of FROZEN_DISPATCH_PATHS) {
			frozen.add(path);
		}
	}
	return frozen;
}

/**
 * Parse `git diff --name-status -z`. NUL-separated, so no path is ever quoted or split on whitespace. A rename carries
 * two paths and is reported as the source leaving and the destination arriving, so a frozen file cannot be renamed
 * out of its path unnoticed; a copy leaves its source untouched and is reported as an arrival only.
 */
export function parseNameStatusZ(output: string): NameStatusEntry[] {
	const fields = output.split("\0");
	const entries: NameStatusEntry[] = [];
	let index = 0;
	while (index < fields.length) {
		const status = fields[index] ?? "";
		if (status.length === 0) {
			index += 1;
			continue;
		}
		if (status.startsWith("R") || status.startsWith("C")) {
			const source = fields[index + 1];
			const destination = fields[index + 2];
			if (status.startsWith("R") && source) {
				entries.push({ status: "D", path: source });
			}
			if (destination) {
				entries.push({ status: "A", path: destination });
			}
			index += 3;
			continue;
		}
		const path = fields[index + 1];
		if (path) {
			entries.push({ status, path });
		}
		index += 2;
	}
	return entries;
}

function toChange(status: string): FrozenPathChange {
	switch (status.charAt(0)) {
		case "A":
			return "added";
		case "D":
			return "deleted";
		case "T":
			return "type_changed";
		default:
			return "modified";
	}
}

/** The frozen paths a delivery touched, once each, sorted — empty when it kept to unfrozen paths. */
export function findFrozenEvidenceViolations(input: {
	readonly frozen: ReadonlySet<string>;
	readonly changes: readonly NameStatusEntry[];
}): FrozenEvidenceViolation[] {
	const violations = new Map<string, FrozenEvidenceViolation>();
	for (const change of input.changes) {
		if (input.frozen.has(change.path) && !violations.has(change.path)) {
			violations.set(change.path, { path: change.path, change: toChange(change.status) });
		}
	}
	return [...violations.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** The refusal a frozen-evidence violation turns into: what moved, why that voids the run, and the way back. */
export function describeFrozenEvidenceViolations(
	violations: readonly FrozenEvidenceViolation[],
): FrozenEvidenceRefusal {
	const width = violations.reduce((widest, violation) => Math.max(widest, violation.change.length), 0);
	const restore =
		violations.length === 1
			? "Restore that file to exactly its content"
			: `Restore those ${violations.length} files to exactly their content`;
	return {
		output: [
			"Frozen evidence modified: this delivery changes files its base commit declares frozen.",
			...violations.map((violation) => `  ${`${violation.change}:`.padEnd(width + 1)} ${violation.path}`),
			"",
			"They are evidence, not workspace. The project's verifier derives what the work must satisfy from them and",
			"`npm test` grades through them, so with any of them changed the acceptance run would be graded by something",
			"other than the task. The acceptance command was not run.",
		].join("\n"),
		hint: `${restore} on the task's base commit and confine the change to the deliverable, then rerun the acceptance check.`,
	};
}
