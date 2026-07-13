import type { RuntimeBoardCard, RuntimeBoardData, RuntimeTaskSessionSummary } from "./api-contract";
import { classifyPackagePairConflict, type PackagePairConflict, type WorkPackage } from "./work-package-dispatch";

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
 * F1.9: a board card as the §5.AK {@link WorkPackage} the dispatch classifier consumes — the card's effective write
 * scope (explicit `writeScope` from the shaped decomposition, else `filesLikelyTouched`) plus its forbidden paths.
 */
/** Strip a trailing glob segment (`/**`, `/*`) so the classifier's directory-prefix containment sees the directory. */
function stripGlobTail(path: string): string {
	return path.replace(/\/\*\*?$/u, "").replace(/\/+$/u, "");
}

export function boardCardToWorkPackage(card: RuntimeBoardCard): WorkPackage {
	const clean = (paths: readonly string[] | undefined): string[] =>
		(paths ?? []).map((path) => stripGlobTail(path.trim())).filter((path) => path.length > 0);
	const writeScope = card.writeScope?.length ? clean(card.writeScope) : clean(card.filesLikelyTouched);
	const forbiddenScope = clean(card.forbiddenPaths);
	return {
		id: card.id,
		writeScope,
		...(forbiddenScope.length > 0 ? { forbiddenScope } : {}),
	};
}

/** F1.9: the full §5.AK pair classification for two cards (green / yellow / red with the concrete reasons). */
export function classifyCardPairConflict(left: RuntimeBoardCard, right: RuntimeBoardCard): PackagePairConflict {
	return classifyPackagePairConflict(boardCardToWorkPackage(left), boardCardToWorkPackage(right));
}

/**
 * Whether two tasks have a SERIALIZING file overlap — F1.9: the §5.AK dispatch classifier's RED class. Red means a
 * shared SPECIFIC write path (a shared coarse manifest/lockfile/config stays yellow and does NOT serialize — the
 * §5.AF/C5 scout fix — so a wide DAG fans out) or either card writing inside the other's `forbiddenPaths` (glob-aware,
 * new with the work-package bounds). Use {@link getSharedLikelyTouchedPaths} to LOG every shared path for diagnostics.
 */
export function tasksHaveLikelyTouchedFileOverlap(left: RuntimeBoardCard, right: RuntimeBoardCard): boolean {
	return classifyCardPairConflict(left, right).conflictClass === "red";
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
