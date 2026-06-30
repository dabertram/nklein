import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import {
	coveredLineCount,
	findRangeContainingLine,
	formatRange,
	hasEofCoverage,
	type LineRange,
	mergeRanges,
} from "./nklein-large-file-line-ranges";
import { assertRealToolPathWithinRoot, confineToolPath } from "./nklein-tool-path-containment";
import type {
	AgentAfterModelContext,
	AgentBeforeModelContext,
	AgentBeforeModelResult,
	AgentMessage,
	AgentTool,
	AgentToolDefinition,
} from "./sdk-agent-types";

const STITCH_CONTEXT_LINES = 20;
const READ_LARGE_FILE_TOOL_NAME = "read_large_file";
/**
 * Simplified protocol (todo §5.O): the model only has to *trigger* the workflow and then keep asking for the
 * "next" step — it never composes the opaque `read:`/`stitch:` cursors (which trip small models). Any of these
 * aliases (or an empty cursor) means "advance from the workflow's own persisted state", which the tool already
 * tracks authoritatively. The explicit cursors are still accepted for back-compat with models that echo them.
 */
const SIMPLE_ADVANCE_CURSORS = new Set(["next", "continue", "auto", "more"]);

interface StitchBoundary {
	leftLine: number;
	rightLine: number;
	verified: boolean;
}

interface StitchingArea {
	boundary: string;
	startLine: number;
	endLine: number;
	stitchLocation: {
		leftLine: number;
		rightLine: number;
		leftPrimaryRange: LineRange | null;
		rightPrimaryRange: LineRange | null;
	};
	content: string;
}

interface LargeFileState {
	path: string;
	absolutePath: string;
	totalLines: number;
	sizeBytes: number;
	primaryRanges: LineRange[];
	stitchBoundaries: StitchBoundary[];
	eofCovered: boolean;
	synthesisCompleted: boolean;
	contentFingerprint: string;
}

interface LargeFileWorkflowIndex {
	version: 1;
	sessionId: string;
	workspacePath: string;
	contextWindow: number | null;
	updatedAt: number;
	files: Record<string, LargeFileState>;
	outputs: Array<{
		toolCallId: string;
		toolName: string;
		path: string;
		sourcePath: string;
		kind: "primary" | "stitch";
		startLine: number;
		endLine: number;
		createdAt: number;
	}>;
}

export function isLargeFileForWorkflow(_sizeBytes: number, tokenCount: number, tokenBudget: number): boolean {
	return tokenCount > tokenBudget;
}

function sanitizePathSegment(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
	return normalized || "session";
}

function buildStitchBoundaries(ranges: readonly LineRange[]): StitchBoundary[] {
	const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
	const boundaries: StitchBoundary[] = [];
	for (let index = 1; index < sorted.length; index += 1) {
		const previous = sorted[index - 1];
		const current = sorted[index];
		if (!previous || !current || current.start > previous.end + 1) {
			continue;
		}
		const leftLine = Math.min(previous.end, current.start - 1);
		const rightLine = Math.max(leftLine + 1, current.start);
		if (!boundaries.some((boundary) => boundary.leftLine === leftLine && boundary.rightLine === rightLine)) {
			boundaries.push({ leftLine, rightLine, verified: false });
		}
	}
	return boundaries;
}

function nextUnreadLine(file: LargeFileState): number {
	let nextLine = 1;
	for (const range of mergeRanges(file.primaryRanges)) {
		if (range.start > nextLine) {
			break;
		}
		nextLine = Math.max(nextLine, range.end + 1);
	}
	return Math.min(nextLine, file.totalLines);
}

function readCursor(file: LargeFileState): string {
	return `read:${nextUnreadLine(file)}:${file.primaryRanges.length + 1}`;
}

function stitchBoundaryCursor(boundary: StitchBoundary, stitchCallIndex: number): string {
	return `stitch:${boundary.leftLine}/${boundary.rightLine}:${stitchCallIndex}`;
}

function nextStitchCursor(file: LargeFileState): string | null {
	const pendingBoundary = file.stitchBoundaries.find((boundary) => !boundary.verified);
	if (!pendingBoundary) {
		return null;
	}
	const verifiedCount = file.stitchBoundaries.filter((boundary) => boundary.verified).length;
	return stitchBoundaryCursor(pendingBoundary, verifiedCount + 1);
}

function toLegacyCursor(cursor: string): string {
	if (cursor.startsWith("read:")) {
		const [_, line] = cursor.split(":");
		return line ? `read:${line}` : cursor;
	}
	if (cursor.startsWith("stitch:")) {
		const [_, boundary] = cursor.split(":");
		return boundary ? `stitch:${boundary}` : cursor;
	}
	return cursor;
}

function expectedCursorForFile(file: LargeFileState): string {
	if (!file.eofCovered) {
		return readCursor(file);
	}
	const pendingStitchCursor = nextStitchCursor(file);
	if (pendingStitchCursor) {
		return pendingStitchCursor;
	}
	return file.synthesisCompleted ? "complete" : "synthesis";
}

function createRailMessage(text: string): AgentMessage {
	return {
		id: `kanban-large-file-rail-${Date.now()}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: Date.now(),
		metadata: {
			kind: "kanban_large_file_rail",
		},
	};
}

function filterToolsByName(
	tools: readonly AgentToolDefinition[],
	allowedToolNames: ReadonlySet<string>,
): readonly AgentToolDefinition[] {
	return tools.filter((tool) => allowedToolNames.has(tool.name));
}

function hasSynthesisText(message: AgentMessage): boolean {
	let hasText = false;
	for (const part of message.content) {
		if (part.type === "tool-call") {
			return false;
		}
		if (part.type === "text" && part.text.trim().length > 0) {
			hasText = true;
		}
	}
	return hasText;
}

function formatOutputHeader(output: {
	kind: "primary" | "stitch";
	sourcePath: string;
	startLine: number;
	endLine: number;
}): string {
	return `### ${output.kind} ${output.sourcePath}:${output.startLine}-${output.endLine}`;
}

function formatStitchingAreaContent(options: {
	path: string;
	boundary: StitchBoundary;
	startLine: number;
	endLine: number;
	lines: readonly string[];
	leftPrimaryRange: LineRange | null;
	rightPrimaryRange: LineRange | null;
}): string {
	const formattedLines: string[] = [];
	for (let lineNumber = options.startLine; lineNumber <= options.endLine; lineNumber += 1) {
		if (lineNumber === options.boundary.rightLine) {
			formattedLines.push(
				`----- STITCH BOUNDARY ${options.boundary.leftLine}/${options.boundary.rightLine}: primary range ${formatRange(options.leftPrimaryRange)} joins ${formatRange(options.rightPrimaryRange)} -----`,
			);
		}
		formattedLines.push(`${lineNumber}: ${options.lines[lineNumber - 1] ?? ""}`);
	}
	return [
		`${formatOutputHeader({
			kind: "stitch",
			sourcePath: options.path,
			startLine: options.startLine,
			endLine: options.endLine,
		})}`,
		`Stitch location: line ${options.boundary.leftLine} -> line ${options.boundary.rightLine}; overlays primary ranges ${formatRange(options.leftPrimaryRange)} and ${formatRange(options.rightPrimaryRange)}.`,
		"This is one discontiguous stitching area from the batch; do not merge it with other areas as one continuous file range.",
		...formattedLines,
	].join("\n");
}

export class NKleinLargeFileWorkflow {
	private readonly index: LargeFileWorkflowIndex;
	private loadPromise: Promise<void> | null = null;
	private writeQueue = Promise.resolve();

	constructor(
		private readonly sessionId: string,
		private readonly workspacePath: string,
		private readonly storageRoot = getRuntimeHomePath(),
	) {
		this.index = {
			version: 1,
			sessionId,
			workspacePath,
			contextWindow: null,
			updatedAt: Date.now(),
			files: {},
			outputs: [],
		};
	}

	async beforeModel(context: AgentBeforeModelContext): Promise<AgentBeforeModelResult | null> {
		await this.ensureLoaded();
		const files = Object.values(this.index.files);
		if (files.length === 0 || files.every((file) => file.synthesisCompleted)) {
			return null;
		}
		const incompleteFiles = files.filter((file) => !file.eofCovered);
		if (incompleteFiles.length > 0) {
			const instructions = incompleteFiles.map(
				(file) =>
					`- Continue ${file.path} from line ${nextUnreadLine(file)} of ${file.totalLines}; call read_large_file with cursor "next"; do not summarize yet.`,
			);
			return {
				messages: [
					...context.request.messages,
					createRailMessage(
						[
							"[!Klein large-file workflow: reading incomplete]",
							...instructions,
							"Call read_large_file again for the same path and update durable running notes after analyzing each returned chunk.",
						].join("\n"),
					),
				],
				tools: filterToolsByName(context.request.tools, new Set([READ_LARGE_FILE_TOOL_NAME])),
			};
		}

		const filesWithPendingStitches = files.filter((file) =>
			file.stitchBoundaries.some((boundary) => !boundary.verified),
		);
		if (filesWithPendingStitches.length > 0) {
			const instructions = filesWithPendingStitches.map((file) => {
				const pendingBoundaries = file.stitchBoundaries.filter((boundary) => !boundary.verified);
				const previews = pendingBoundaries
					.slice(0, 8)
					.map((boundary) => {
						const startLine = Math.max(1, boundary.leftLine - STITCH_CONTEXT_LINES + 1);
						const endLine = Math.min(file.totalLines, boundary.rightLine + STITCH_CONTEXT_LINES - 1);
						return `${boundary.leftLine}/${boundary.rightLine} (${startLine}-${endLine})`;
					})
					.join(", ");
				const remainingText = pendingBoundaries.length > 8 ? `, +${pendingBoundaries.length - 8} more` : "";
				return `- ${file.path}: ${pendingBoundaries.length} pending stitching area${pendingBoundaries.length === 1 ? "" : "s"} [${previews}${remainingText}]. Make one read_large_file call with cursor "next"; the tool will return as many pending areas as fit. Do not call each boundary separately.`;
			});
			return {
				messages: [
					...context.request.messages,
					createRailMessage(
						[
							"[!Klein large-file workflow: stitching required before synthesis]",
							...instructions,
							"Call read_large_file (not read_files) exactly once in this assistant response. Never issue parallel read_large_file calls for stitching boundaries.",
							"The tool automatically returns as many separate pending stitching areas as fit the current context budget and advances the workflow state.",
							"Each returned stitching area is laid over its own primary-chunk boundary with an explicit boundary marker. Analyze each area independently against the running notes; do not treat the first area start through the last area end as one continuous read.",
							"Do not produce the final synthesis until every stitching area has been verified through read_large_file.",
						].join("\n"),
					),
				],
				tools: filterToolsByName(context.request.tools, new Set([READ_LARGE_FILE_TOOL_NAME])),
			};
		}

		const coverageSummary = files.map(
			(file) =>
				`  - ${file.path}: ${file.totalLines} lines covered across ${file.primaryRanges.length} primary chunk${file.primaryRanges.length === 1 ? "" : "s"} and ${file.stitchBoundaries.length} stitching area${file.stitchBoundaries.length === 1 ? "" : "s"}`,
		);
		const persistedContext = await this.buildPersistedSynthesisContext();
		return {
			messages: [
				...context.request.messages,
				createRailMessage(
					[
						"[!Klein large-file workflow: verified coverage parked]",
						"Complete large-file coverage is verified and persisted for:",
						...coverageSummary,
						...persistedContext,
						"If the user's task mentions additional source files that are not covered yet, continue with discovery or the next exact file now; do not synthesize early.",
						"If all required source files are covered, write the final synthesis now from running notes plus persisted read_large_file context, reconciling each marked stitching boundary in place without treating discontiguous stitching areas as one continuous source range.",
					].join("\n"),
				),
			],
			tools: context.request.tools,
		};
	}

	async afterModel(context: AgentAfterModelContext): Promise<undefined> {
		await this.ensureLoaded();
		if (context.finishReason !== "stop" || !hasSynthesisText(context.assistantMessage)) {
			return undefined;
		}
		const files = Object.values(this.index.files);
		const readyForSynthesis =
			files.length > 0 &&
			files.every((file) => file.eofCovered && file.stitchBoundaries.every((boundary) => boundary.verified));
		if (!readyForSynthesis) {
			return undefined;
		}
		for (const file of files) {
			file.synthesisCompleted = true;
		}
		await this.persistIndex();
		return undefined;
	}

	async getReadFilesBlockingReason(): Promise<string | null> {
		await this.ensureLoaded();
		const files = Object.values(this.index.files).filter((file) => !file.synthesisCompleted);
		if (files.length === 0) {
			return null;
		}
		const pendingReads = files.filter((file) => !file.eofCovered);
		if (pendingReads.length > 0) {
			const paths = pendingReads.map((file) => `${file.path} from line ${nextUnreadLine(file)}`).join(", ");
			return `Blocked read_files: finish the active read_large_file workflow first (${paths}). Continue with read_large_file; no read_files content was read.`;
		}
		const pendingStitches = files.filter((file) => file.stitchBoundaries.some((boundary) => !boundary.verified));
		if (pendingStitches.length > 0) {
			const paths = pendingStitches.map((file) => file.path).join(", ");
			return `Blocked read_files: finish read_large_file stitching verification first (${paths}). Continue with read_large_file; no read_files content was read.`;
		}
		return null;
	}

	async getReadLargeFileBlockingReason(): Promise<string | null> {
		await this.ensureLoaded();
		return null;
	}

	async readNext(
		pathInput: string,
		contextWindow?: number | null,
		cursorInput?: string | null,
	): Promise<Record<string, unknown>> {
		await this.ensureLoaded();
		const path = pathInput.trim();
		if (!path) {
			throw new Error("read_large_file requires a non-empty path.");
		}
		this.recordContextWindow(contextWindow);
		const contained = confineToolPath(this.workspacePath, path);
		if (!contained.ok) {
			throw new Error(`Blocked read_large_file: ${contained.message}`);
		}
		const real = await assertRealToolPathWithinRoot(
			contained.matchedRoot,
			contained.absolutePath,
			contained.relativePath,
		);
		if (!real.ok) {
			throw new Error(`Blocked read_large_file: ${real.message}`);
		}
		const absolutePath = contained.absolutePath;
		const content = await readFile(absolutePath, "utf8");
		const lines = content.split("\n");
		const sizeBytes = Buffer.byteLength(content, "utf8");
		const contentFingerprint = createHash("sha256").update(content).digest("hex");
		let file: LargeFileState | undefined = this.index.files[absolutePath];
		if (file && file.contentFingerprint !== contentFingerprint) {
			file = undefined;
		}
		if (!file) {
			file = {
				path,
				absolutePath,
				totalLines: lines.length,
				sizeBytes,
				primaryRanges: [],
				stitchBoundaries: [],
				eofCovered: false,
				synthesisCompleted: false,
				contentFingerprint,
			};
			this.index.files[absolutePath] = file;
		}

		const expectedCursor = expectedCursorForFile(file);
		const normalizedExpectedCursor = expectedCursor.startsWith("read:1:") ? "start" : expectedCursor;
		// Simplified protocol (§5.O): an empty cursor or a `next`/`continue`/`auto`/`more` alias means "advance from
		// the workflow's own persisted state", so the model never has to compose `read:`/`stitch:` cursors. Explicit
		// cursors are still validated against the expected step (back-compat with models that echo `nextCursor`).
		const rawCursor = typeof cursorInput === "string" ? cursorInput.trim() : "";
		const providedCursor =
			rawCursor.length === 0 || SIMPLE_ADVANCE_CURSORS.has(rawCursor.toLowerCase())
				? normalizedExpectedCursor
				: rawCursor;
		const legacyExpectedCursor = toLegacyCursor(normalizedExpectedCursor);
		const allowsLegacySynthesisCursor = normalizedExpectedCursor === "complete" && providedCursor === "synthesis";
		if (
			providedCursor !== normalizedExpectedCursor &&
			providedCursor !== legacyExpectedCursor &&
			!allowsLegacySynthesisCursor
		) {
			const synthesisHint =
				normalizedExpectedCursor === "synthesis"
					? ` ${path} is already fully covered through EOF and all stitching areas are verified. Do not read more from this file; either move to other required source files or synthesize from the persisted context.`
					: "";
			throw new Error(
				`read_large_file expected the next step for ${path} (cursor "${normalizedExpectedCursor}").${synthesisHint} Just retry with {"path":"${path}","cursor":"next"} to continue.`,
			);
		}

		const pendingBoundary = file.stitchBoundaries.find((boundary) => !boundary.verified);
		if (file.eofCovered && pendingBoundary) {
			const budgets = buildKanbanContextSafetyBudgets(contextWindow);
			const stitchingAreas: StitchingArea[] = [];
			let usedTokens = 0;
			for (const boundary of file.stitchBoundaries.filter((entry) => !entry.verified)) {
				const startLine = Math.max(1, boundary.leftLine - STITCH_CONTEXT_LINES + 1);
				const endLine = Math.min(file.totalLines, boundary.rightLine + STITCH_CONTEXT_LINES - 1);
				const leftPrimaryRange = findRangeContainingLine(file.primaryRanges, boundary.leftLine);
				const rightPrimaryRange = findRangeContainingLine(file.primaryRanges, boundary.rightLine);
				const content = formatStitchingAreaContent({
					path,
					boundary,
					startLine,
					endLine,
					lines,
					leftPrimaryRange,
					rightPrimaryRange,
				});
				const areaTokens = countKanbanTextTokens(content);
				if (stitchingAreas.length > 0 && usedTokens + areaTokens > budgets.fileChunkContentTokenBudget) {
					break;
				}
				stitchingAreas.push({
					boundary: `${boundary.leftLine}/${boundary.rightLine}`,
					startLine,
					endLine,
					stitchLocation: {
						leftLine: boundary.leftLine,
						rightLine: boundary.rightLine,
						leftPrimaryRange,
						rightPrimaryRange,
					},
					content,
				});
				usedTokens += areaTokens;
				boundary.verified = true;
				await this.persistToolOutput("stitch", path, startLine, endLine, content);
			}
			const firstArea = stitchingAreas[0];
			if (!firstArea) {
				throw new Error(`Unable to build stitching window for ${path}.`);
			}
			const chunk = [
				"[!Klein stitching areas: discontiguous boundary windows]",
				`Returned ${stitchingAreas.length} separate stitching area${stitchingAreas.length === 1 ? "" : "s"}. Each area is laid over its own primary-chunk boundary; do not treat the first start line through the last end line as one continuous read.`,
				...stitchingAreas.map((area) => area.content),
			].join("\n\n");
			const verifiedBoundaries = file.stitchBoundaries.filter((boundary) => boundary.verified).length;
			const totalBoundaries = file.stitchBoundaries.length;
			return {
				phase: "stitching",
				path,
				totalLines: file.totalLines,
				boundary: firstArea.boundary,
				stitchingAreas,
				windows: stitchingAreas,
				// Index/total progress so the model iterates by "areas done" instead of composing stitch cursors (§5.O).
				progress: `Verified ${verifiedBoundaries} of ${totalBoundaries} stitching area${totalBoundaries === 1 ? "" : "s"}.`,
				verifiedStitchingAreas: verifiedBoundaries,
				totalStitchingAreas: totalBoundaries,
				nextCursor: nextStitchCursor(file) ?? "synthesis",
				content: chunk,
				instruction: file.stitchBoundaries.some((boundary) => !boundary.verified)
					? `Analyze these ${stitchingAreas.length} separate stitching area${stitchingAreas.length === 1 ? "" : "s"} against the running notes, reconcile only the marked boundary in each area, then wait until the next assistant response before making exactly one read_large_file call with cursor "next" for the next batch. Do not call read_large_file in parallel.`
					: `Analyze these ${stitchingAreas.length} final separate stitching area${stitchingAreas.length === 1 ? "" : "s"} against the running notes and reconcile only the marked boundary in each area. Do not call read_large_file in parallel or make another read_large_file call now; the next model request will require final synthesis.`,
			};
		}

		if (file.eofCovered) {
			await this.persistIndex();
			return {
				phase: file.synthesisCompleted ? "complete" : "synthesis",
				path,
				totalLines: file.totalLines,
				nextCursor: file.synthesisCompleted ? "complete" : "synthesis",
				coverageStatus: "complete",
				instruction: file.synthesisCompleted
					? "This large-file workflow is complete. Re-open it only if the source changes or the user asks for a new analysis."
					: "All primary chunks and stitching areas for this file are covered and verified. Do not call read_large_file again for this file except with cursor `synthesis`. Either continue with other required source files or produce the final deduplicated synthesis now from the persisted context.",
			};
		}

		const budgets = buildKanbanContextSafetyBudgets(contextWindow);
		const startLine = nextUnreadLine(file);
		const bytesPerLine = Math.max(1, sizeBytes / Math.max(1, lines.length));
		const suggestedLines = Math.max(1, Math.floor((budgets.fileChunkCharBudget * 0.7) / bytesPerLine));
		let endLine = Math.min(file.totalLines, startLine + suggestedLines - 1);
		let chunk = lines.slice(startLine - 1, endLine).join("\n");
		while (endLine > startLine && countKanbanTextTokens(chunk) > budgets.fileChunkContentTokenBudget) {
			endLine = Math.max(startLine, startLine + Math.floor((endLine - startLine) / 2));
			chunk = lines.slice(startLine - 1, endLine).join("\n");
		}
		if (countKanbanTextTokens(chunk) > budgets.fileChunkContentTokenBudget) {
			throw new Error(
				`Line ${startLine} of ${path} exceeds the safe large-file chunk budget by itself. Inspect that line with a specialized tool.`,
			);
		}

		file.primaryRanges.push({ start: startLine, end: endLine });
		file.eofCovered = hasEofCoverage(file.primaryRanges, file.totalLines);
		if (file.eofCovered) {
			file.stitchBoundaries = buildStitchBoundaries(file.primaryRanges);
		}
		await this.persistToolOutput("primary", path, startLine, endLine, chunk);
		const nextCursor = expectedCursorForFile(file);
		const normalizedNextCursor = nextCursor.startsWith("read:1:") ? "start" : nextCursor;
		const coveredLines = coveredLineCount(file.primaryRanges);
		const percentCovered = Math.min(100, Math.round((coveredLines / Math.max(1, file.totalLines)) * 100));
		return {
			phase: "reading",
			path,
			startLine,
			endLine,
			totalLines: file.totalLines,
			// Index/total progress so the model can iterate by "where am I" instead of bookkeeping cursors (§5.O).
			progress: `Covered ${coveredLines} of ${file.totalLines} lines (${percentCovered}%).`,
			coveredLines,
			percentCovered,
			nextCursor: normalizedNextCursor,
			content: chunk,
			instruction: file.eofCovered
				? file.stitchBoundaries.length > 0
					? 'EOF is covered. Analyze this chunk, update running notes, then call read_large_file again with cursor "next" to begin stitching verification.'
					: "EOF is covered in one chunk. Analyze it; the next model request will require final synthesis."
				: `Analyze this chunk and update durable running notes, then call read_large_file again with cursor "next" for the following chunk (next unread line ${endLine + 1} of ${file.totalLines}).`,
		};
	}

	private recordContextWindow(contextWindow?: number | null): void {
		if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
			return;
		}
		this.index.contextWindow = Math.trunc(contextWindow);
	}

	private async buildPersistedSynthesisContext(): Promise<string[]> {
		if (this.index.outputs.length === 0) {
			return [];
		}
		const budgets = buildKanbanContextSafetyBudgets(this.index.contextWindow);
		const maxTokens = Math.max(
			budgets.fileChunkContentTokenBudget,
			budgets.safeWorkingBudget ? Math.floor(budgets.safeWorkingBudget * 0.75) : budgets.fileChunkContentTokenBudget,
		);
		const sections: string[] = [];
		let usedTokens = countKanbanTextTokens("[!Klein persisted read_large_file context]\n");
		for (const output of this.index.outputs) {
			const content = await readFile(join(this.getWorkflowRoot(), output.path), "utf8").catch(() => null);
			if (!content) {
				continue;
			}
			const section = `${formatOutputHeader(output)}\n${content}`;
			const sectionTokens = countKanbanTextTokens(section);
			if (sections.length > 0 && usedTokens + sectionTokens > maxTokens) {
				break;
			}
			sections.push(section);
			usedTokens += sectionTokens;
		}
		if (sections.length === 0) {
			return [
				"[!Klein persisted read_large_file context]",
				"No persisted read outputs fit the current synthesis budget; use the running notes already in context.",
			];
		}
		return [
			"[!Klein persisted read_large_file context]",
			`Included ${sections.length} of ${this.index.outputs.length} persisted read_large_file output${this.index.outputs.length === 1 ? "" : "s"} within the synthesis budget.`,
			...sections,
		];
	}

	private async persistToolOutput(
		kind: "primary" | "stitch",
		path: string,
		startLine: number,
		endLine: number,
		output: string,
	): Promise<void> {
		const toolCallId = `${kind}-${startLine}-${endLine}-${randomUUID()}`;
		const outputPath = join("outputs", `${sanitizePathSegment(toolCallId)}.txt`);
		this.index.outputs.push({
			toolCallId,
			toolName: "read_large_file",
			path: outputPath,
			sourcePath: path,
			kind,
			startLine,
			endLine,
			createdAt: Date.now(),
		});
		await this.persist(outputPath, output);
	}

	private async persist(outputPath: string, output: string): Promise<void> {
		const workflowRoot = this.getWorkflowRoot();
		this.writeQueue = this.writeQueue.then(async () => {
			await mkdir(join(workflowRoot, "outputs"), { recursive: true });
			await writeFile(join(workflowRoot, outputPath), output, "utf8");
			await this.writeIndex(workflowRoot);
		});
		await this.writeQueue;
	}

	private async persistIndex(): Promise<void> {
		const workflowRoot = this.getWorkflowRoot();
		this.writeQueue = this.writeQueue.then(async () => {
			await mkdir(workflowRoot, { recursive: true });
			await this.writeIndex(workflowRoot);
		});
		await this.writeQueue;
	}

	private async writeIndex(workflowRoot: string): Promise<void> {
		this.index.updatedAt = Date.now();
		await lockedFileSystem.writeTextFileAtomic(
			join(workflowRoot, "index.json"),
			`${JSON.stringify(this.index, null, 2)}\n`,
		);
	}

	private async ensureLoaded(): Promise<void> {
		if (!this.loadPromise) {
			this.loadPromise = this.loadIndex();
		}
		await this.loadPromise;
	}

	private async loadIndex(): Promise<void> {
		const rawIndex = await readFile(join(this.getWorkflowRoot(), "index.json"), "utf8").catch(() => null);
		if (!rawIndex) {
			return;
		}
		try {
			const stored = JSON.parse(rawIndex) as Partial<LargeFileWorkflowIndex>;
			if (
				stored.version !== 1 ||
				stored.sessionId !== this.sessionId ||
				stored.workspacePath !== this.workspacePath ||
				!stored.files ||
				typeof stored.files !== "object" ||
				!Array.isArray(stored.outputs)
			) {
				return;
			}
			this.index.updatedAt = typeof stored.updatedAt === "number" ? stored.updatedAt : Date.now();
			this.index.files = stored.files;
			this.index.outputs = stored.outputs;
		} catch {
			// Ignore an incomplete or outdated side-store index and start a fresh workflow.
		}
	}

	private getWorkflowRoot(): string {
		return resolve(this.storageRoot, "tool-output", sanitizePathSegment(this.sessionId));
	}
}

const workflowsBySessionId = new Map<string, NKleinLargeFileWorkflow>();

export function getNKleinLargeFileWorkflow(sessionId: string, workspacePath: string): NKleinLargeFileWorkflow {
	const existing = workflowsBySessionId.get(sessionId);
	if (existing) {
		return existing;
	}
	const workflow = new NKleinLargeFileWorkflow(sessionId, workspacePath);
	workflowsBySessionId.set(sessionId, workflow);
	return workflow;
}

export function releaseNKleinLargeFileWorkflow(sessionId: string): void {
	workflowsBySessionId.delete(sessionId);
}

export function releaseAllNKleinLargeFileWorkflows(): void {
	workflowsBySessionId.clear();
}

export function createReadLargeFileTool(options: {
	sessionId: string;
	workspacePath: string;
	contextWindow?: number | null;
	storageRoot?: string;
}): AgentTool {
	const workflow = options.storageRoot
		? new NKleinLargeFileWorkflow(options.sessionId, options.workspacePath, options.storageRoot)
		: getNKleinLargeFileWorkflow(options.sessionId, options.workspacePath);
	return createReadLargeFileToolForWorkflow(workflow, options.contextWindow);
}

function createReadLargeFileToolForWorkflow(
	workflow: NKleinLargeFileWorkflow,
	contextWindow?: number | null,
): AgentTool {
	return {
		name: "read_large_file",
		description:
			'Read and analyze a large text file through !Klein\'s enforced workflow. Trigger it with just the file `path`; then call it again with `cursor: "next"` to advance through each chunk and, afterwards, each stitching area, until it reports the synthesis phase. !Klein tracks where you are — you never compute offsets or cursors. Each result reports your progress (lines/areas covered of the total). Make one call at a time; never call this tool in parallel.',
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute path or workspace-relative path to the large text file.",
				},
				cursor: {
					type: "string",
					description:
						'Use "next" to advance to the next step (the tool tracks your position); omit it for the same effect. A `nextCursor` value echoed from a previous result is also accepted.',
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
		async execute(input) {
			if (!input || typeof input !== "object" || typeof (input as Record<string, unknown>).path !== "string") {
				throw new Error("read_large_file requires a string path field.");
			}
			const record = input as Record<string, unknown>;
			const cursor = typeof record.cursor === "string" ? record.cursor : "next";
			return await workflow.readNext(record.path as string, contextWindow, cursor);
		},
	};
}
