/**
 * Placeholder / stub scanner (pure) — a mechanical enforcement of the §4A "no built-but-not-wired" rule, ported from
 * opencode-swarm's `placeholder_scan` gate and adapted to !Klein's delivery-gate model. It flags the tell-tale marks of
 * unfinished work an agent may leave behind — TODO/FIXME markers, `throw new Error("not implemented")`, stub bodies,
 * placeholder returns — so the delivery gate can HOLD a card whose diff introduces them rather than shipping a stub.
 *
 * Pure + language-agnostic (line + regex based): the caller feeds the content it wants scanned — typically the ADDED
 * lines of a card's diff, so a pre-existing TODO elsewhere never blocks an unrelated card. The effectful b-leaf runs
 * this at the delivery seam and maps a non-empty result to a boundary-style hold signal.
 */

export type PlaceholderFindingKind =
	| "todo_comment"
	| "fixme_comment"
	| "not_implemented_throw"
	| "stub_body"
	| "placeholder_return"
	| "empty_catch";

export interface PlaceholderFinding {
	readonly kind: PlaceholderFindingKind;
	/** Repo-relative path of the file the finding is in. */
	readonly path: string;
	/** 1-indexed line within the scanned content. */
	readonly line: number;
	/** The trimmed offending line (bounded), for the operator surface. */
	readonly snippet: string;
}

export interface PlaceholderScanResult {
	readonly findings: readonly PlaceholderFinding[];
	/** Count per kind (all kinds present, 0 when none) — the operator summary. */
	readonly summary: Readonly<Record<PlaceholderFindingKind, number>>;
	/** True when any finding was raised — the gate's HOLD signal. */
	readonly hasPlaceholders: boolean;
}

export interface PlaceholderScanConfig {
	/**
	 * Marker words treated as an unfinished-work comment (case-insensitive, matched only inside a comment). Defaults to
	 * the conventional set; a project can extend or narrow it (e.g. drop `HACK` if it uses it deliberately).
	 */
	readonly commentMarkers?: readonly string[];
	/** Cap on the retained snippet length (defaults to 200). */
	readonly maxSnippetLength?: number;
}

const DEFAULT_COMMENT_MARKERS = ["TODO", "FIXME", "XXX", "HACK"] as const;
const DEFAULT_MAX_SNIPPET = 200;

/** A comment marker is only a finding when it sits inside a comment (`//`, `#`, `/*`, `*`, `<!--`), not in a string. */
function commentMarkerKind(line: string, markers: readonly string[]): PlaceholderFindingKind | null {
	const commentMatch = line.match(/(^|[^:])(\/\/|#|\/\*|\*(?!\/)|<!--)/);
	if (!commentMatch) {
		return null;
	}
	const commentStart = commentMatch.index ?? 0;
	const commentText = line.slice(commentStart);
	const upper = commentText.toUpperCase();
	for (const marker of markers) {
		// Word-boundary match so `TODO` fires but `todos` / a path like `todo.md` in prose does not.
		const pattern = new RegExp(`\\b${marker.toUpperCase()}\\b`);
		if (pattern.test(upper)) {
			return marker.toUpperCase() === "FIXME" ? "fixme_comment" : "todo_comment";
		}
	}
	return null;
}

/** A `throw` that announces unimplemented work — `throw new Error("not implemented")`, `NotImplementedError`, etc. */
function notImplementedThrow(line: string): boolean {
	const lower = line.toLowerCase();
	if (!lower.includes("throw") && !lower.includes("notimplemented")) {
		return false;
	}
	return /not[\s_-]?implemented|unimplemented|notimplementederror|todo:?\s*implement/i.test(line);
}

/** A stub body: a lone `pass` (python), a bare `...` placeholder statement, or `return;` immediately after a stub note. */
function stubBody(line: string): boolean {
	const trimmed = line.trim();
	return trimmed === "pass" || trimmed === "..." || trimmed === "raise NotImplementedError";
}

/** A placeholder return: `return null`/`undefined`/`{}`/`[]`/`""` explicitly tagged as a placeholder in a trailing note. */
function placeholderReturn(line: string): boolean {
	if (!/\breturn\b/.test(line)) {
		return false;
	}
	return /return\s+(null|undefined|\{\}|\[\]|""|''|0)\s*;?\s*(\/\/|#).*(todo|placeholder|stub|for now|temporary)/i.test(
		line,
	);
}

/** An empty catch block that swallows the error with only a placeholder note (a silent-failure smell). */
function emptyCatchPlaceholder(line: string): boolean {
	return /catch\s*(\([^)]*\))?\s*\{\s*(\/\/|#)\s*(todo|ignore|noop|swallow|placeholder)/i.test(line);
}

export function scanForPlaceholders(
	files: readonly { path: string; content: string }[],
	config: PlaceholderScanConfig = {},
): PlaceholderScanResult {
	const markers = config.commentMarkers ?? DEFAULT_COMMENT_MARKERS;
	const maxSnippet = config.maxSnippetLength ?? DEFAULT_MAX_SNIPPET;
	const summary: Record<PlaceholderFindingKind, number> = {
		todo_comment: 0,
		fixme_comment: 0,
		not_implemented_throw: 0,
		stub_body: 0,
		placeholder_return: 0,
		empty_catch: 0,
	};
	const findings: PlaceholderFinding[] = [];
	const push = (kind: PlaceholderFindingKind, path: string, line: number, raw: string): void => {
		summary[kind] += 1;
		findings.push({ kind, path, line, snippet: raw.trim().slice(0, maxSnippet) });
	};

	for (const file of files) {
		const lines = file.content.replace(/\r\n/g, "\n").split("\n");
		for (let index = 0; index < lines.length; index += 1) {
			const raw = lines[index];
			const lineNumber = index + 1;
			// Order matters: the most specific classifiers first so a line is attributed to its strongest signal.
			if (notImplementedThrow(raw)) {
				push("not_implemented_throw", file.path, lineNumber, raw);
				continue;
			}
			if (emptyCatchPlaceholder(raw)) {
				push("empty_catch", file.path, lineNumber, raw);
				continue;
			}
			if (placeholderReturn(raw)) {
				push("placeholder_return", file.path, lineNumber, raw);
				continue;
			}
			if (stubBody(raw)) {
				push("stub_body", file.path, lineNumber, raw);
				continue;
			}
			const markerKind = commentMarkerKind(raw, markers);
			if (markerKind) {
				push(markerKind, file.path, lineNumber, raw);
			}
		}
	}

	return { findings, summary, hasPlaceholders: findings.length > 0 };
}
