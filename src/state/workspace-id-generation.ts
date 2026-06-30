import { randomBytes } from "node:crypto";
import { basename } from "node:path";

/**
 * Pure workspace-id primitives extracted from workspace-state: the slug base derived from a repo
 * path, and a random collision suffix. They depend only on node builtins (no workspace state), so
 * they are behavior-preserving relative to their inline definitions. The id assembly itself —
 * combining the base with a suffix and checking the index for collisions — stays in workspace-state.
 */

/**
 * Derive the human-readable id base from a repo path: the trimmed folder name, NFKD-normalized,
 * lowercased, non-alphanumerics collapsed to single dashes, edges trimmed. Falls back to `"project"`
 * when the path has no usable folder name or normalizes to empty.
 */
export function toWorkspaceIdBase(repoPath: string): string {
	const trimmed = repoPath.trim().replace(/[\\/]+$/g, "");
	const folderName = basename(trimmed) || "project";
	const normalized = folderName
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "project";
}

/** A random lowercase-alphanumeric suffix of the given length, used to disambiguate colliding workspace ids. */
export function createWorkspaceIdCollisionSuffix(length: number): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let suffix = "";
	while (suffix.length < length) {
		const bytes = randomBytes(length);
		for (const byte of bytes) {
			suffix += alphabet[byte % alphabet.length] ?? "";
			if (suffix.length === length) {
				break;
			}
		}
	}
	return suffix;
}
