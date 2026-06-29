import type { RuntimeBoardCard, RuntimeBoardData, RuntimeTaskSessionSummary } from "./api-contract";

const ACTIVE_SESSION_STATES = new Set<RuntimeTaskSessionSummary["state"]>(["queued", "running", "awaiting_review"]);

function normalizeLikelyTouchedPath(path: string): string {
	return path
		.trim()
		.replace(/^\.\/+/, "")
		.toLowerCase();
}

function getLikelyTouchedPathSet(task: RuntimeBoardCard): Set<string> {
	return new Set((task.filesLikelyTouched ?? []).map(normalizeLikelyTouchedPath).filter((path) => path.length > 0));
}

/**
 * The normalized paths two tasks both list in `filesLikelyTouched` (sorted, deduped) — the concrete reason an auto-start
 * is serialized. Returned so the runtime can LOG the culprit path(s): a single shared coarse file (e.g. a barrel index or
 * `package.json` the decompose model defensively listed for many cards) over-serializing a wide DAG is exactly the
 * signal we need to root-cause the C3/C5 throughput finding (todo §5.AF scout) before tuning the heuristic.
 */
export function getSharedLikelyTouchedPaths(left: RuntimeBoardCard, right: RuntimeBoardCard): string[] {
	const leftPaths = getLikelyTouchedPathSet(left);
	if (leftPaths.size === 0) {
		return [];
	}
	const shared = new Set<string>();
	for (const path of getLikelyTouchedPathSet(right)) {
		if (leftPaths.has(path)) {
			shared.add(path);
		}
	}
	return [...shared].sort();
}

// Low-signal "coarse" files a decompose model defensively lists on MANY cards (a dependency manifest, a lockfile, a
// repo-root config) — a shared one of these is not a real edit-conflict signal, and serializing a wide DAG on it is
// the over-serialization the §5.AF/C5 scout finding flagged. Matched by basename (paths are already lowercased).
const COARSE_LIKELY_TOUCHED_BASENAMES = new Set<string>([
	"package.json",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"biome.json",
	".gitignore",
	".npmrc",
	"readme.md",
	"changelog.md",
	"requirements.txt",
	"pyproject.toml",
	"poetry.lock",
	"cargo.toml",
	"cargo.lock",
	"go.mod",
	"go.sum",
	"makefile",
	"dockerfile",
]);

/** True for a low-signal shared path (manifest / lockfile / repo-root config) that shouldn't, alone, serialize cards. */
export function isCoarseLikelyTouchedPath(normalizedPath: string): boolean {
	const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
	return COARSE_LIKELY_TOUCHED_BASENAMES.has(basename) || /^tsconfig\..+\.json$/.test(basename);
}

/** The shared SPECIFIC (non-coarse) paths — the real edit-conflict signal that warrants serializing two cards. */
export function getSharedSpecificLikelyTouchedPaths(left: RuntimeBoardCard, right: RuntimeBoardCard): string[] {
	return getSharedLikelyTouchedPaths(left, right).filter((path) => !isCoarseLikelyTouchedPath(path));
}

/**
 * Whether two tasks have a SERIALIZING file overlap. Only a shared SPECIFIC source path counts — a shared coarse file
 * (a defensively-listed `package.json`/lockfile/config) does NOT serialize, so a wide DAG fans out instead of queueing
 * behind one card (§5.AF/C5 scout fix). A genuine manifest conflict is rare and handled downstream (merge + §5.AK
 * conflict classification), not by blocking auto-start. Use {@link getSharedLikelyTouchedPaths} to LOG every shared
 * path (incl. coarse) for diagnostics.
 */
export function tasksHaveLikelyTouchedFileOverlap(left: RuntimeBoardCard, right: RuntimeBoardCard): boolean {
	return getSharedSpecificLikelyTouchedPaths(left, right).length > 0;
}

export function findActiveTaskLikelyTouchedFileOverlap(input: {
	board: RuntimeBoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	task: RuntimeBoardCard;
}): RuntimeBoardCard | null {
	for (const session of Object.values(input.sessions)) {
		if (session.taskId === input.task.id || !ACTIVE_SESSION_STATES.has(session.state)) {
			continue;
		}
		for (const column of input.board.columns) {
			const activeTask = column.cards.find((card) => card.id === session.taskId) ?? null;
			if (activeTask && tasksHaveLikelyTouchedFileOverlap(input.task, activeTask)) {
				return activeTask;
			}
		}
	}
	return null;
}
