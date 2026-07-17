/**
 * F12.23 first-turn repo bootstrap fact-sheet — PURE core.
 *
 * A small model's first ~10 turns are usually spent re-discovering what a machine already knows: what runtime this
 * repo is, how to run its tests, where the entry points are. This composer derives that fact-sheet DETERMINISTICALLY
 * from manifest contents the caller reads (package.json today; other manifests slot in later) so the first prompt
 * carries the facts and the turns go to the task. Facts only — no advice, no guesses; an unknown stays unsaid.
 */

export interface RepoManifestInput {
	/** Raw package.json text, when the repo has one; null otherwise. */
	readonly packageJsonText: string | null;
	/** Top-level directory names (for the layout line); empty = omit. */
	readonly topLevelDirs: readonly string[];
}

export interface RepoFactSheet {
	readonly lines: readonly string[];
	/** Rendered block for the start prompt, or null when nothing could be derived (never emit an empty shell). */
	readonly rendered: string | null;
}

const INTERESTING_SCRIPTS = ["test", "build", "lint", "typecheck", "check", "dev", "start"] as const;

/** Compose the fact-sheet from manifest facts. Pure; malformed JSON contributes nothing rather than throwing. */
export function buildRepoFactSheet(input: RepoManifestInput): RepoFactSheet {
	const lines: string[] = [];
	if (input.packageJsonText) {
		try {
			const manifest = JSON.parse(input.packageJsonText) as {
				name?: unknown;
				scripts?: Record<string, unknown>;
				main?: unknown;
				bin?: unknown;
				type?: unknown;
				workspaces?: unknown;
			};
			if (typeof manifest.name === "string" && manifest.name) {
				lines.push(`Package: ${manifest.name}${manifest.type === "module" ? " (ESM)" : ""}`);
			}
			const scripts = manifest.scripts ?? {};
			const known = INTERESTING_SCRIPTS.filter((key) => typeof scripts[key] === "string").map(
				(key) => `npm run ${key}`,
			);
			if (known.length > 0) {
				lines.push(`Commands that exist: ${known.join(" · ")}`);
			}
			if (typeof manifest.main === "string") {
				lines.push(`Entry point: ${manifest.main}`);
			}
			if (manifest.workspaces) {
				lines.push("Monorepo: npm workspaces — check the sub-package nearest your files for its own scripts.");
			}
		} catch {
			// Malformed manifest — say nothing rather than guessing.
		}
	}
	if (input.topLevelDirs.length > 0) {
		lines.push(`Top-level layout: ${[...input.topLevelDirs].sort().slice(0, 12).join(", ")}`);
	}
	return {
		lines,
		rendered:
			lines.length === 0
				? null
				: ["[Repo facts — machine-derived; spend your turns on the task, not rediscovery]", ...lines].join("\n"),
	};
}
