/**
 * F11.2h in-repo few-shot exemplar injection (CEDAR-style, deterministic retrieval).
 *
 * The cheapest way to make a small model write code that LOOKS NATIVE is to show it 1–2 similar existing
 * functions from this repo as style/API exemplars — retrieval-augmented few-shot beats fine-tuning at ~2 shots
 * (CEDAR ICSE'23). This module retrieves them WITHOUT a model: candidate = every named, exemplar-sized function
 * declaration; similarity = identifier-token overlap with the task text (camelCase-aware); the card's own target
 * files are excluded (the worker already reads those). Rendering is prompt-ready and honestly labeled as style
 * reference, not instruction. Activation is OPT-IN (`NKLEIN_FEWSHOT_EXEMPLARS`) until a fleet A/B proves the
 * token cost pays for itself.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import ts from "typescript";
import { listSourceFiles } from "./source-file-scan";

export interface FewShotExemplar {
	readonly path: string;
	readonly name: string;
	readonly lineStart: number;
	readonly lineEnd: number;
	readonly snippet: string;
	/** Overlap score in (0,1] — kept for telemetry/thresholding; not rendered. */
	readonly score: number;
}

const TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;
const MAX_EXEMPLAR_LINES = 50;
const MIN_OVERLAP_SCORE = 0.12;

/** Split an identifier or prose into lowercase tokens (camelCase / snake_case / punctuation aware). */
export function tokenizeForOverlap(text: string): Set<string> {
	const tokens = new Set<string>();
	for (const raw of text.split(/[^A-Za-z0-9]+/)) {
		for (const piece of raw.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ")) {
			const token = piece.toLowerCase();
			if (token.length >= 3) {
				tokens.add(token);
			}
		}
	}
	return tokens;
}

interface ExemplarCandidate {
	readonly path: string;
	readonly name: string;
	readonly lineStart: number;
	readonly lineEnd: number;
	readonly snippet: string;
	readonly tokens: Set<string>;
}

/** Extract every named, exemplar-sized function from a TS/JS file (declarations + arrow/function consts). */
export function extractFunctionExemplarCandidates(path: string, content: string): ExemplarCandidate[] {
	if (!TS_EXTENSIONS.test(path)) {
		return [];
	}
	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(
			path,
			content,
			ts.ScriptTarget.Latest,
			true,
			/\.(tsx|jsx)$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
	} catch {
		return [];
	}
	const lines = content.split("\n");
	const candidates: ExemplarCandidate[] = [];
	const pushCandidate = (name: string, node: ts.Node): void => {
		const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
		const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
		if (lineEnd - lineStart + 1 > MAX_EXEMPLAR_LINES) {
			return;
		}
		const snippet = lines.slice(lineStart - 1, lineEnd).join("\n");
		candidates.push({ path, name, lineStart, lineEnd, snippet, tokens: tokenizeForOverlap(`${name} ${snippet}`) });
	};
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
			pushCandidate(statement.name.text, statement);
		} else if (ts.isVariableStatement(statement)) {
			const declaration = statement.declarationList.declarations[0];
			if (
				declaration &&
				ts.isIdentifier(declaration.name) &&
				declaration.initializer &&
				(ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
			) {
				pushCandidate(declaration.name.text, statement);
			}
		}
	}
	return candidates;
}

/** Jaccard-style overlap of the task tokens against a candidate's tokens (asymmetric: how much of the task it covers). */
function overlapScore(taskTokens: ReadonlySet<string>, candidateTokens: ReadonlySet<string>): number {
	if (taskTokens.size === 0 || candidateTokens.size === 0) {
		return 0;
	}
	let hits = 0;
	for (const token of taskTokens) {
		if (candidateTokens.has(token)) {
			hits += 1;
		}
	}
	return hits / taskTokens.size;
}

/** Pick the 1–2 most task-similar exemplars across pre-extracted candidates. Pure. */
export function selectFewShotExemplars(options: {
	taskText: string;
	/** The card's own target files — excluded (the worker reads those anyway; an exemplar must be OTHER code). */
	targetPaths: readonly string[];
	candidates: readonly ExemplarCandidate[];
	maxExemplars?: number;
}): FewShotExemplar[] {
	const taskTokens = tokenizeForOverlap(options.taskText);
	const targetPathSet = new Set(options.targetPaths);
	const maxExemplars = Math.max(1, Math.min(4, options.maxExemplars ?? 2));
	const scored = options.candidates
		.filter((candidate) => !targetPathSet.has(candidate.path))
		.map((candidate) => ({ candidate, score: overlapScore(taskTokens, candidate.tokens) }))
		.filter((entry) => entry.score >= MIN_OVERLAP_SCORE)
		.sort(
			(left, right) =>
				right.score - left.score ||
				`${left.candidate.path}:${left.candidate.name}`.localeCompare(
					`${right.candidate.path}:${right.candidate.name}`,
				),
		);
	const picked: FewShotExemplar[] = [];
	const usedPaths = new Set<string>();
	for (const entry of scored) {
		if (picked.length >= maxExemplars) {
			break;
		}
		// One exemplar per file — two shots from the same file teach less than two files' worth of house style.
		if (usedPaths.has(entry.candidate.path)) {
			continue;
		}
		usedPaths.add(entry.candidate.path);
		const { tokens: _tokens, ...exemplar } = entry.candidate;
		picked.push({ ...exemplar, score: entry.score });
	}
	return picked;
}

/** Render the prompt block — honestly labeled STYLE REFERENCE, never an instruction to copy. Null when empty. */
export function renderFewShotExemplarBlock(exemplars: readonly FewShotExemplar[]): string | null {
	if (exemplars.length === 0) {
		return null;
	}
	return [
		"[Style exemplars: similar EXISTING functions from this repo. Match their conventions (naming, error handling, docs) — do not copy their logic.]",
		...exemplars.map((exemplar) =>
			[`— ${exemplar.path}:${exemplar.lineStart} (${exemplar.name})`, "```", exemplar.snippet, "```"].join("\n"),
		),
	].join("\n");
}

/** Scan the workspace and select exemplars for a task. Best-effort: any failure yields []. */
export async function selectWorkspaceFewShotExemplars(options: {
	workspacePath: string;
	taskText: string;
	targetPaths: readonly string[];
	maxFiles?: number;
	maxExemplars?: number;
}): Promise<FewShotExemplar[]> {
	try {
		const filePaths = await listSourceFiles(options.workspacePath, options.maxFiles ?? 400);
		const candidates: ExemplarCandidate[] = [];
		for (const filePath of filePaths) {
			const path = relative(options.workspacePath, filePath);
			if (!TS_EXTENSIONS.test(path)) {
				continue;
			}
			try {
				candidates.push(...extractFunctionExemplarCandidates(path, await readFile(filePath, "utf8")));
			} catch {
				// Unreadable file — skip.
			}
		}
		return selectFewShotExemplars({
			taskText: options.taskText,
			targetPaths: options.targetPaths,
			candidates,
			...(options.maxExemplars !== undefined ? { maxExemplars: options.maxExemplars } : {}),
		});
	} catch {
		return [];
	}
}
