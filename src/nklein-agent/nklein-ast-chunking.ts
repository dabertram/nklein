/**
 * F11.2i cAST-style AST-aware chunking for the code index (split-then-merge).
 *
 * Fixed line windows split functions mid-body — the embedding then represents half a thought, and retrieval
 * recall drops (cAST measured +4.3 Recall@5 / +2.67 Pass@1 from boundary-respecting chunks). This module computes
 * chunk SPANS for TS/JS files at declaration boundaries: top-level statements are the atoms; an atom bigger than
 * the budget SPLITS at its child boundaries (class members, function-body statements — one structural level per
 * recursion, fixed lines only as the last resort); consecutive small atoms MERGE greedily up to the budget. The
 * spans partition the file exactly (no gaps, no overlap), so the index still covers every line. Non-TS files
 * return null — the caller keeps its fixed-window fallback.
 */

import ts from "typescript";

export interface AstChunkSpan {
	/** 1-based inclusive. */
	readonly lineStart: number;
	/** 1-based inclusive. */
	readonly lineEnd: number;
	/** The named top-level declaration containing the span's start — the chunk's context label; null between/outside. */
	readonly enclosing: string | null;
}

const TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

function getScriptKind(path: string): ts.ScriptKind {
	return /\.(tsx|jsx)$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** 1-based start line of a node (its own start, not leading trivia). */
function startLine(node: ts.Node, sourceFile: ts.SourceFile): number {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** The child nodes worth splitting an oversize declaration at (one structural level). */
function splittableChildren(node: ts.Node): readonly ts.Node[] {
	if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
		return node.members;
	}
	if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body) {
		return node.body.statements;
	}
	if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
		return node.body.statements;
	}
	if (ts.isVariableStatement(node)) {
		const initializer = node.declarationList.declarations[0]?.initializer;
		if (
			initializer &&
			(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
			initializer.body &&
			ts.isBlock(initializer.body)
		) {
			return initializer.body.statements;
		}
		if (initializer && ts.isObjectLiteralExpression(initializer)) {
			return initializer.properties;
		}
	}
	return [];
}

/**
 * Partition [segmentStart, segmentEnd] at the given inner boundary lines (clamped, deduped, sorted), then split
 * any oversize piece further: structurally when `node` offers children, at fixed lines as the last resort.
 */
function partitionSegment(
	segmentStart: number,
	segmentEnd: number,
	node: ts.Node | null,
	sourceFile: ts.SourceFile,
	budgetLines: number,
	depth: number,
): Array<{ start: number; end: number }> {
	if (segmentEnd - segmentStart + 1 <= budgetLines) {
		return [{ start: segmentStart, end: segmentEnd }];
	}
	const children = node && depth < 3 ? splittableChildren(node) : [];
	const childBoundaries = [
		...new Set(
			children
				.map((child) => ({ child, line: startLine(child, sourceFile) }))
				.filter((entry) => entry.line > segmentStart && entry.line <= segmentEnd)
				.map((entry) => entry.line),
		),
	].sort((left, right) => left - right);
	if (childBoundaries.length === 0) {
		// Last resort: fixed-line split — the atom has no usable structure below this level.
		const pieces: Array<{ start: number; end: number }> = [];
		for (let start = segmentStart; start <= segmentEnd; start += budgetLines) {
			pieces.push({ start, end: Math.min(segmentEnd, start + budgetLines - 1) });
		}
		return pieces;
	}
	const childByLine = new Map(children.map((child) => [startLine(child, sourceFile), child] as const));
	const boundaries = [segmentStart, ...childBoundaries];
	const pieces: Array<{ start: number; end: number }> = [];
	for (const [index, boundary] of boundaries.entries()) {
		const pieceEnd = index + 1 < boundaries.length ? (boundaries[index + 1] as number) - 1 : segmentEnd;
		if (pieceEnd < boundary) {
			continue;
		}
		pieces.push(
			...partitionSegment(boundary, pieceEnd, childByLine.get(boundary) ?? null, sourceFile, budgetLines, depth + 1),
		);
	}
	return pieces;
}

/** The name of a top-level declaration, when it has one. */
function topLevelName(node: ts.Node): string | null {
	if (
		(ts.isFunctionDeclaration(node) ||
			ts.isClassDeclaration(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isTypeAliasDeclaration(node) ||
			ts.isEnumDeclaration(node)) &&
		node.name
	) {
		return node.name.text;
	}
	if (ts.isVariableStatement(node)) {
		const name = node.declarationList.declarations[0]?.name;
		if (name && ts.isIdentifier(name)) {
			return name.text;
		}
	}
	return null;
}

/**
 * Compute boundary-respecting chunk spans for a TS/JS file, or null for other files (caller falls back to fixed
 * windows). The spans partition every line of the file exactly once, in order.
 */
export function computeAstChunkSpans(path: string, content: string, budgetLines: number): AstChunkSpan[] | null {
	if (!TS_EXTENSIONS.test(path)) {
		return null;
	}
	const budget = Math.max(8, Math.trunc(budgetLines));
	const totalLines = content.split("\n").length;
	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, getScriptKind(path));
	} catch {
		return null;
	}
	const statements = [...sourceFile.statements];
	if (statements.length === 0) {
		return totalLines > 0 ? [{ lineStart: 1, lineEnd: totalLines, enclosing: null }] : [];
	}

	// Atoms: partition the file at top-level statement starts (leading imports/comments ride the first atom),
	// splitting oversize atoms structurally.
	const statementStarts = statements.map((statement) => ({ statement, line: startLine(statement, sourceFile) }));
	const atoms: Array<{ start: number; end: number }> = [];
	let cursor = 1;
	for (const [index, entry] of statementStarts.entries()) {
		const nextStart =
			index + 1 < statementStarts.length ? (statementStarts[index + 1] as { line: number }).line : totalLines + 1;
		const start = Math.min(cursor, entry.line);
		const end = nextStart - 1;
		if (end < start) {
			continue;
		}
		atoms.push(...partitionSegment(start, end, entry.statement, sourceFile, budget, 0));
		cursor = end + 1;
	}
	if (cursor <= totalLines) {
		atoms.push({ start: cursor, end: totalLines });
	}

	// Greedy merge: consecutive atoms pack into chunks up to the budget — small declarations share a chunk, a
	// function boundary is never crossed mid-atom.
	const merged: Array<{ start: number; end: number }> = [];
	for (const atom of atoms) {
		const last = merged[merged.length - 1];
		if (last && atom.end - last.start + 1 <= budget) {
			merged[merged.length - 1] = { start: last.start, end: atom.end };
		} else {
			merged.push({ ...atom });
		}
	}

	// Context labels: the named top-level declaration whose span contains each chunk's start.
	const namedSpans = statementStarts
		.map((entry, index) => ({
			name: topLevelName(entry.statement),
			start: entry.line,
			end:
				index + 1 < statementStarts.length ? (statementStarts[index + 1] as { line: number }).line - 1 : totalLines,
		}))
		.filter((span): span is { name: string; start: number; end: number } => span.name !== null);
	const enclosingFor = (line: number): string | null =>
		namedSpans.find((span) => line >= span.start && line <= span.end)?.name ?? null;

	return merged.map((chunk) => ({
		lineStart: chunk.start,
		lineEnd: chunk.end,
		enclosing: enclosingFor(chunk.start),
	}));
}
