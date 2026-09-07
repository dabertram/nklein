/**
 * Generated dependency lockfiles are not task authorship when their manifest did not change.
 *
 * v31 factory 2026-09-07: three result branches (s05a, s09a, s09a1) carried NOTHING but a 1,530-line
 * `package-lock.json` that `npm install` — the worker's own install, the toolchain priming, the acceptance run —
 * had generated on a repo whose main has no lockfile. The review loop judged that churn as "the work" for 2,466
 * rounds, every merge of two such branches conflicted on the lockfile, and the test-driven gate bounced a change no
 * model had authored. The rule here is the one a human reviewer applies: a lockfile is a DERIVED artifact of its
 * manifest. When the manifest in that directory (or, for workspace-aware managers, any manifest below it) is
 * untouched, the lockfile change is tooling churn and is dropped from the captured patch. A manifest change keeps
 * its lockfile (a dependency bump is real work). An operator who wants the churn kept sets
 * `NKLEIN_CAPTURE_KEEP_GENERATED_LOCKFILES=1`.
 */

export const CAPTURE_KEEP_GENERATED_LOCKFILES_ENV = "NKLEIN_CAPTURE_KEEP_GENERATED_LOCKFILES";

export interface StagedPathChange {
	/** Git name-status code: `A` added, `M` modified, `D` deleted, `T` type change, `R…`/`C…` rename/copy score. */
	status: string;
	/** Repository-relative path (the destination for renames/copies). */
	path: string;
}

export interface GeneratedLockfileDrop {
	path: string;
	status: string;
	/** Manifest basenames (or `*.ext` suffix patterns) whose change would have kept this lockfile. */
	manifests: readonly string[];
}

/** Lockfile basename (lowercased) → the manifest basenames / `*.ext` patterns (lowercased) that own it. */
const MANIFESTS_BY_LOCKFILE: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
	["package-lock.json", ["package.json"]],
	["npm-shrinkwrap.json", ["package.json"]],
	["yarn.lock", ["package.json"]],
	["pnpm-lock.yaml", ["package.json", "pnpm-workspace.yaml"]],
	["bun.lock", ["package.json"]],
	["bun.lockb", ["package.json"]],
	["cargo.lock", ["cargo.toml"]],
	["go.sum", ["go.mod", "go.work"]],
	["poetry.lock", ["pyproject.toml"]],
	["uv.lock", ["pyproject.toml"]],
	["pdm.lock", ["pyproject.toml"]],
	["pipfile.lock", ["pipfile"]],
	["gemfile.lock", ["gemfile", "*.gemspec"]],
	["composer.lock", ["composer.json"]],
	["mix.lock", ["mix.exs"]],
	["pubspec.lock", ["pubspec.yaml"]],
	["podfile.lock", ["podfile"]],
	["flake.lock", ["flake.nix"]],
	["packages.lock.json", ["*.csproj", "*.fsproj", "directory.packages.props"]],
]);

const NAME_STATUS_CODE = /^[ACDMRTUXB]\d*$/u;

function basenameOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash >= 0 ? path.slice(slash + 1) : path;
}

function dirnameOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash >= 0 ? path.slice(0, slash) : "";
}

function isWithinDirectory(path: string, directory: string): boolean {
	return directory === "" || path.startsWith(`${directory}/`);
}

function manifestMatches(basename: string, pattern: string): boolean {
	return pattern.startsWith("*.") ? basename.endsWith(pattern.slice(1)) : basename === pattern;
}

/**
 * Parse `git diff --name-status -z` output. Renames/copies (`R100\0old\0new\0`) yield the destination plus a
 * deletion of the source, so a moved manifest still counts as touched. Anything that is not a status code followed
 * by a path is ignored — the capture must never fail over a listing it cannot read.
 */
export function parseGitNameStatusZ(stdout: string): StagedPathChange[] {
	const fields = stdout.split("\0");
	const changes: StagedPathChange[] = [];
	let index = 0;
	while (index < fields.length) {
		const status = fields[index] ?? "";
		if (status === "") {
			index += 1;
			continue;
		}
		if (!NAME_STATUS_CODE.test(status)) {
			// Not a name-status record (e.g. a diff body handed to us by mistake): skip the field.
			index += 1;
			continue;
		}
		if (status.startsWith("R") || status.startsWith("C")) {
			const source = fields[index + 1];
			const destination = fields[index + 2];
			if (source === undefined || destination === undefined || destination === "") {
				break;
			}
			changes.push({ status, path: destination });
			if (status.startsWith("R") && source !== "") {
				changes.push({ status: "D", path: source });
			}
			index += 3;
			continue;
		}
		const path = fields[index + 1];
		if (path === undefined || path === "") {
			break;
		}
		changes.push({ status, path });
		index += 2;
	}
	return changes;
}

/**
 * The staged lockfile changes that are tooling churn: their owning manifest — same directory, or any directory
 * below it (npm/yarn/pnpm/cargo workspaces regenerate the ROOT lockfile from a nested manifest) — is not part of
 * the same staged change set. A lockfile whose manifest changed is authorship and stays.
 */
export function selectGeneratedLockfilesToDrop(changes: readonly StagedPathChange[]): GeneratedLockfileDrop[] {
	const drops: GeneratedLockfileDrop[] = [];
	for (const change of changes) {
		const manifests = MANIFESTS_BY_LOCKFILE.get(basenameOf(change.path).toLowerCase());
		if (!manifests) {
			continue;
		}
		const directory = dirnameOf(change.path);
		const manifestChanged = changes.some((other) => {
			if (other === change || !isWithinDirectory(other.path, directory)) {
				return false;
			}
			const otherBasename = basenameOf(other.path).toLowerCase();
			return manifests.some((pattern) => manifestMatches(otherBasename, pattern));
		});
		if (manifestChanged) {
			continue;
		}
		drops.push({ path: change.path, status: change.status, manifests });
	}
	return drops;
}

/**
 * The git command that removes one dropped lockfile change from the staged patch. A lockfile the base never had
 * is unstaged and left untracked (the next install rewrites it anyway); a modified or deleted one is restored to
 * the base's copy in both the index and the working tree.
 */
export function buildGeneratedLockfileRestoreCommand(drop: GeneratedLockfileDrop, baseRef: string | null): string[] {
	if (drop.status.startsWith("A")) {
		return ["git", "rm", "-q", "--cached", "--", drop.path];
	}
	return ["git", "checkout", "-q", baseRef ?? "HEAD", "--", drop.path];
}
