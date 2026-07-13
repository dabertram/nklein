// P0.9c residue trim: only the presence-keyed add-project guard survives from the retired host-worktree subsystem —
// it rejects (or health-migrates) a legacy on-disk worktree folder added as a project. The display-path
// reconstruction and per-task path builders went with the legacy trashed-card UI and the cleanup modules.

function normalizePathForComparison(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function isPathInsideTaskWorktreesHome(path: string, taskWorktreesHomePath: string): boolean {
	const normalizedPath = normalizePathForComparison(path);
	const normalizedRoot = normalizePathForComparison(taskWorktreesHomePath);
	if (!normalizedPath || !normalizedRoot) {
		return false;
	}
	if (process.platform === "win32") {
		const lowerPath = normalizedPath.toLowerCase();
		const lowerRoot = normalizedRoot.toLowerCase();
		return lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`);
	}
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}
