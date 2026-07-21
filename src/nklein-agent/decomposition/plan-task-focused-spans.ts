import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { computeAstChunkSpans } from "../nklein-ast-chunking";
import { lexicalScore } from "../nklein-lexical-score";
import type { NKleinPlanTask } from "../nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";

const MAX_FILES_PER_TASK = 8;
const MAX_FILE_BYTES = 256 * 1024;
const SPAN_LINE_BUDGET = 48;
/** The live F11.2d A/B found no benefit at the 35B-A3B ceiling; preserve prompt budget above this measured tier. */
export const FOCUSED_SPAN_CAPABILITY_CEILING = 90;

export interface PlanTaskFocusedSpan {
	readonly path: string;
	readonly lineStart: number;
	readonly lineEnd: number;
	readonly symbol: string | null;
	readonly content: string;
	readonly score: number;
}

interface CandidateSpan extends PlanTaskFocusedSpan {
	readonly stableKey: string;
}

function taskQuery(task: NKleinPlanTask): string {
	return [task.title, task.prompt, task.knowledgeDebt ?? "", ...task.filesLikelyTouched].join("\n");
}

function fixedLineSpans(totalLines: number): Array<{ lineStart: number; lineEnd: number; enclosing: null }> {
	const spans: Array<{ lineStart: number; lineEnd: number; enclosing: null }> = [];
	for (let lineStart = 1; lineStart <= totalLines; lineStart += SPAN_LINE_BUDGET) {
		spans.push({ lineStart, lineEnd: Math.min(totalLines, lineStart + SPAN_LINE_BUDGET - 1), enclosing: null });
	}
	return spans;
}

async function readContainedRegularFile(workspaceRealPath: string, relativePath: string): Promise<string | null> {
	if (!relativePath.trim() || isAbsolute(relativePath)) {
		return null;
	}
	const unresolved = resolve(workspaceRealPath, relativePath);
	let resolved: string;
	try {
		resolved = await realpath(unresolved);
	} catch {
		return null;
	}
	if (resolved !== workspaceRealPath && !resolved.startsWith(`${workspaceRealPath}${sep}`)) {
		return null;
	}
	try {
		const fileStat = await stat(resolved);
		if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) {
			return null;
		}
		return await readFile(resolved, "utf8");
	} catch {
		return null;
	}
}

/**
 * Select one bounded, production-compatible top-1 code span for a generated leaf card. Every failure abstains: a stale
 * path, binary/oversize file, parse problem, or containment violation leaves the existing pull retrieval path intact.
 */
export async function selectPlanTaskFocusedSpan(input: {
	readonly workspacePath: string;
	readonly task: NKleinPlanTask;
}): Promise<PlanTaskFocusedSpan | null> {
	let workspaceRealPath: string;
	try {
		workspaceRealPath = await realpath(input.workspacePath);
	} catch {
		return null;
	}
	const query = taskQuery(input.task);
	const candidates: CandidateSpan[] = [];
	for (const rawPath of input.task.filesLikelyTouched.slice(0, MAX_FILES_PER_TASK)) {
		const normalizedPath = relative(input.workspacePath, resolve(input.workspacePath, rawPath)).split(sep).join("/");
		if (!normalizedPath || normalizedPath.startsWith("../") || normalizedPath === "..") {
			continue;
		}
		const content = await readContainedRegularFile(workspaceRealPath, normalizedPath);
		if (content === null || content.includes("\0")) {
			continue;
		}
		const lines = content.split("\n");
		const spans = computeAstChunkSpans(normalizedPath, content, SPAN_LINE_BUDGET) ?? fixedLineSpans(lines.length);
		for (const span of spans) {
			const spanContent = lines.slice(span.lineStart - 1, span.lineEnd).join("\n");
			const symbol = span.enclosing;
			const score = lexicalScore(`${normalizedPath}\n${symbol ?? basename(normalizedPath)}\n${spanContent}`, query);
			candidates.push({
				path: normalizedPath,
				lineStart: span.lineStart,
				lineEnd: span.lineEnd,
				symbol,
				content: spanContent,
				score,
				stableKey: `${normalizedPath}:${String(span.lineStart).padStart(9, "0")}`,
			});
		}
	}
	const selected = candidates.sort(
		(left, right) => right.score - left.score || left.stableKey.localeCompare(right.stableKey),
	)[0];
	if (!selected || selected.score <= 0) {
		return null;
	}
	const { stableKey: _stableKey, ...focusedSpan } = selected;
	return focusedSpan;
}

export function formatPlanTaskFocusedSpan(span: PlanTaskFocusedSpan | null | undefined): string | null {
	if (!span) {
		return null;
	}
	return [
		"Focused code span (automatic top-1 localization; verify before editing and use retrieval if it is not relevant):",
		`Path: ${span.path}:${span.lineStart}`,
		...(span.symbol ? [`Symbol: ${span.symbol}`] : []),
		"```",
		span.content,
		"```",
	].join("\n");
}

/**
 * Push spans where the A/B found the gain: smaller/lower-capability or not-yet-selected local models. A model already
 * above the measured capability ceiling keeps the pull path and avoids the campaign's ~489-token average push cost.
 */
export function shouldAttachPlanTaskFocusedSpan(candidate: NKleinTaskRoutingCandidate | null | undefined): boolean {
	if (!candidate) {
		return true;
	}
	const capability = candidate.entry.capability.effectiveScore;
	return !Number.isFinite(capability) || capability <= FOCUSED_SPAN_CAPABILITY_CEILING;
}

export async function buildPlanTaskFocusedSpans(input: {
	readonly workspacePath: string;
	readonly tasks: readonly NKleinPlanTask[];
}): Promise<Readonly<Record<string, string>>> {
	const entries = await Promise.all(
		input.tasks.map(async (task) => {
			const formatted = formatPlanTaskFocusedSpan(
				await selectPlanTaskFocusedSpan({ workspacePath: input.workspacePath, task }),
			);
			return formatted ? ([task.id, formatted] as const) : null;
		}),
	);
	return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}
