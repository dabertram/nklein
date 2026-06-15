import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
	AgentAfterModelContext,
	AgentBeforeModelContext,
	AgentBeforeModelResult,
	AgentMessage,
	AgentTool,
	AgentToolDefinition,
} from "@clinebot/shared";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./cline-context-budgets";

const LARGE_FILE_BYTES = 100 * 1024;
const STITCH_CONTEXT_LINES = 20;
const READ_LARGE_FILE_TOOL_NAME = "read_large_file";

export interface ReadFileRequest {
	path: string;
	startLine: number | null;
	endLine: number | null;
}

interface LineRange {
	start: number;
	end: number;
}

interface StitchBoundary {
	leftLine: number;
	rightLine: number;
	verified: boolean;
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

function asNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.trunc(value);
}

export function parseReadFileRequests(input: unknown): ReadFileRequest[] {
	const toRequest = (value: unknown): ReadFileRequest | null => {
		if (typeof value === "string") {
			const path = value.trim();
			return path ? { path, startLine: null, endLine: null } : null;
		}
		if (!value || typeof value !== "object") {
			return null;
		}
		const record = value as Record<string, unknown>;
		const path = typeof record.path === "string" ? record.path.trim() : "";
		return path
			? {
					path,
					startLine: asNumber(record.start_line),
					endLine: asNumber(record.end_line),
				}
			: null;
	};

	if (typeof input === "string") {
		const request = toRequest(input);
		return request ? [request] : [];
	}
	if (Array.isArray(input)) {
		return input.map(toRequest).filter((request): request is ReadFileRequest => request !== null);
	}
	if (!input || typeof input !== "object") {
		return [];
	}
	const record = input as Record<string, unknown>;
	for (const key of ["files", "file_paths", "paths"] as const) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value.map(toRequest).filter((request): request is ReadFileRequest => request !== null);
		}
		if (value !== undefined) {
			const request = toRequest(value);
			return request ? [request] : [];
		}
	}
	const request = toRequest(record);
	return request ? [request] : [];
}

export function isLargeFileForWorkflow(sizeBytes: number, tokenCount: number, tokenBudget: number): boolean {
	return sizeBytes > LARGE_FILE_BYTES || tokenCount > tokenBudget;
}

function sanitizePathSegment(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
	return normalized || "session";
}

function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
	const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: LineRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, range.end);
			continue;
		}
		merged.push({ ...range });
	}
	return merged;
}

function hasEofCoverage(ranges: readonly LineRange[], totalLines: number): boolean {
	const firstRange = mergeRanges(ranges)[0];
	return Boolean(firstRange && firstRange.start === 1 && firstRange.end >= totalLines);
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

export class ClineLargeFileWorkflow {
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
					`- Continue ${file.path} from line ${nextUnreadLine(file)} through line ${file.totalLines}; call read_large_file with cursor \`${expectedCursorForFile(file)}\`; do not summarize yet.`,
			);
			return {
				messages: [
					...context.request.messages,
					createRailMessage(
						[
							"[Kanban large-file workflow: reading incomplete]",
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
			const instructions = filesWithPendingStitches.flatMap((file) =>
				file.stitchBoundaries
					.filter((boundary) => !boundary.verified)
					.map((boundary, pendingIndex) => {
						const startLine = Math.max(1, boundary.leftLine - STITCH_CONTEXT_LINES + 1);
						const endLine = Math.min(file.totalLines, boundary.rightLine + STITCH_CONTEXT_LINES - 1);
						const stitchedBefore = file.stitchBoundaries.filter((entry) => entry.verified).length;
						const cursor = stitchBoundaryCursor(boundary, stitchedBefore + pendingIndex + 1);
						return `- Verify boundary ${boundary.leftLine}/${boundary.rightLine} in ${file.path} (lines ${startLine}-${endLine}): call read_large_file with cursor \`${cursor}\` — do NOT use read_files.`;
					}),
			);
			return {
				messages: [
					...context.request.messages,
					createRailMessage(
						[
							"[Kanban large-file workflow: stitching required before synthesis]",
							...instructions,
							"Call read_large_file (not read_files) once for the file path. The tool automatically returns as many pending stitching windows as fit the current context budget and advances the workflow state.",
							"Do not produce the final synthesis until every stitching window has been verified through read_large_file.",
						].join("\n"),
					),
				],
				tools: filterToolsByName(context.request.tools, new Set([READ_LARGE_FILE_TOOL_NAME])),
			};
		}

		const coverageSummary = files.map(
			(file) =>
				`  - ${file.path}: ${file.totalLines} lines covered across ${file.primaryRanges.length} primary chunk${file.primaryRanges.length === 1 ? "" : "s"} and ${file.stitchBoundaries.length} stitching window${file.stitchBoundaries.length === 1 ? "" : "s"}`,
		);
		const persistedContext = await this.buildPersistedSynthesisContext();
		return {
			messages: [
				...context.request.messages,
				createRailMessage(
					[
						"[Kanban large-file workflow: SYNTHESIS NOW — stop reading]",
						"Complete coverage verified for:",
						...coverageSummary,
						...persistedContext,
						"DO NOT call read_large_file, read_files, or any other file-reading tool. Use the running notes and the persisted read_large_file context above.",
						"Write the final synthesis now as your response text: consolidate the running notes and the persisted read_large_file context above, deduplicate overlapping content, reconcile boundary-spanning statements, and preserve all distinct requirements.",
						"Your immediate output must be the complete synthesis — not a tool call.",
					].join("\n"),
				),
			],
			tools: [],
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
		const paths = files.map((file) => file.path).join(", ");
		return `Blocked read_files: read_large_file coverage is complete for ${paths}, but final synthesis is still required. Produce the synthesis before reading other files; no read_files content was read.`;
	}

	async getReadLargeFileBlockingReason(): Promise<string | null> {
		await this.ensureLoaded();
		const files = Object.values(this.index.files).filter((file) => !file.synthesisCompleted);
		if (files.length === 0) {
			return null;
		}
		const readyForSynthesis = files.every(
			(file) => file.eofCovered && file.stitchBoundaries.every((boundary) => boundary.verified),
		);
		if (!readyForSynthesis) {
			return null;
		}
		const paths = files.map((file) => file.path).join(", ");
		return `Blocked read_large_file: coverage is complete for ${paths}, but final synthesis is still required. Produce the synthesis now; no file content was read.`;
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
		const absolutePath = isAbsolute(path) ? path : resolve(this.workspacePath, path);
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
		const providedCursor =
			typeof cursorInput === "string" && cursorInput.trim().length > 0 ? cursorInput.trim() : "start";
		const normalizedExpectedCursor = expectedCursor.startsWith("read:1:") ? "start" : expectedCursor;
		const legacyExpectedCursor = toLegacyCursor(normalizedExpectedCursor);
		const allowsLegacySynthesisCursor = normalizedExpectedCursor === "complete" && providedCursor === "synthesis";
		if (
			providedCursor !== normalizedExpectedCursor &&
			providedCursor !== legacyExpectedCursor &&
			!allowsLegacySynthesisCursor
		) {
			throw new Error(
				`read_large_file expected cursor "${normalizedExpectedCursor}" for ${path}. Retry with {"path":"${path}","cursor":"${normalizedExpectedCursor}"}.`,
			);
		}

		const pendingBoundary = file.stitchBoundaries.find((boundary) => !boundary.verified);
		if (file.eofCovered && pendingBoundary) {
			const budgets = buildKanbanContextSafetyBudgets(contextWindow);
			const windows: Array<{
				boundary: string;
				startLine: number;
				endLine: number;
				content: string;
			}> = [];
			let usedTokens = 0;
			for (const boundary of file.stitchBoundaries.filter((entry) => !entry.verified)) {
				const startLine = Math.max(1, boundary.leftLine - STITCH_CONTEXT_LINES + 1);
				const endLine = Math.min(file.totalLines, boundary.rightLine + STITCH_CONTEXT_LINES - 1);
				const content = lines.slice(startLine - 1, endLine).join("\n");
				const windowTokens = countKanbanTextTokens(content);
				if (windows.length > 0 && usedTokens + windowTokens > budgets.fileChunkContentTokenBudget) {
					break;
				}
				windows.push({
					boundary: `${boundary.leftLine}/${boundary.rightLine}`,
					startLine,
					endLine,
					content,
				});
				usedTokens += windowTokens;
				boundary.verified = true;
				await this.persistToolOutput("stitch", path, startLine, endLine, content);
			}
			const firstWindow = windows[0];
			if (!firstWindow) {
				throw new Error(`Unable to build stitching window for ${path}.`);
			}
			const chunk = windows
				.map(
					(window) =>
						`${formatOutputHeader({
							kind: "stitch",
							sourcePath: path,
							startLine: window.startLine,
							endLine: window.endLine,
						})}\n${window.content}`,
				)
				.join("\n\n");
			return {
				phase: "stitching",
				path,
				startLine: firstWindow.startLine,
				endLine: windows.at(-1)?.endLine ?? firstWindow.endLine,
				totalLines: file.totalLines,
				boundary: firstWindow.boundary,
				windows,
				nextCursor: nextStitchCursor(file) ?? "synthesis",
				content: chunk,
				instruction: file.stitchBoundaries.some((boundary) => !boundary.verified)
					? `Analyze these ${windows.length} stitching window${windows.length === 1 ? "" : "s"} against the running notes, then call read_large_file again with cursor \`${nextStitchCursor(file)}\` for the next batch.`
					: `Analyze these ${windows.length} final stitching window${windows.length === 1 ? "" : "s"} against the running notes. The next model request will require final synthesis.`,
			};
		}

		if (file.eofCovered) {
			await this.persistIndex();
			return {
				phase: file.synthesisCompleted ? "complete" : "synthesis",
				path,
				totalLines: file.totalLines,
				nextCursor: file.synthesisCompleted ? "complete" : "synthesis",
				instruction: file.synthesisCompleted
					? "This large-file workflow is complete. Re-open it only if the source changes or the user asks for a new analysis."
					: "All primary chunks and stitching windows are covered. Produce the final deduplicated synthesis now.",
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
		return {
			phase: "reading",
			path,
			startLine,
			endLine,
			totalLines: file.totalLines,
			nextCursor: normalizedNextCursor,
			content: chunk,
			instruction: file.eofCovered
				? file.stitchBoundaries.length > 0
					? `EOF is covered. Analyze this chunk, update running notes, then call read_large_file again with cursor \`${normalizedNextCursor}\` to begin stitching verification.`
					: "EOF is covered in one chunk. Analyze it; the next model request will require final synthesis."
				: `Analyze this chunk and update durable running notes, then call read_large_file again with cursor \`${normalizedNextCursor}\`. Next unread line: ${endLine + 1}.`,
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
		let usedTokens = countKanbanTextTokens("[Kanban persisted read_large_file context]\n");
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
				"[Kanban persisted read_large_file context]",
				"No persisted read outputs fit the current synthesis budget; use the running notes already in context.",
			];
		}
		return [
			"[Kanban persisted read_large_file context]",
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

const workflowsBySessionId = new Map<string, ClineLargeFileWorkflow>();

export function getClineLargeFileWorkflow(sessionId: string, workspacePath: string): ClineLargeFileWorkflow {
	const existing = workflowsBySessionId.get(sessionId);
	if (existing) {
		return existing;
	}
	const workflow = new ClineLargeFileWorkflow(sessionId, workspacePath);
	workflowsBySessionId.set(sessionId, workflow);
	return workflow;
}

export function releaseClineLargeFileWorkflow(sessionId: string): void {
	workflowsBySessionId.delete(sessionId);
}

export function releaseAllClineLargeFileWorkflows(): void {
	workflowsBySessionId.clear();
}

export function createReadLargeFileTool(options: {
	sessionId: string;
	workspacePath: string;
	contextWindow?: number | null;
}): AgentTool {
	const workflow = getClineLargeFileWorkflow(options.sessionId, options.workspacePath);
	return {
		name: "read_large_file",
		description:
			"Read and analyze a large text file through Kanban's enforced workflow. Repeated calls automatically advance through safe primary chunks, required stitching windows, then final synthesis.",
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
						"Workflow cursor from the previous read_large_file result (`nextCursor`). Use `start` for the first call on a file.",
				},
			},
			required: ["path", "cursor"],
			additionalProperties: false,
		},
		async execute(input) {
			if (
				!input ||
				typeof input !== "object" ||
				typeof (input as Record<string, unknown>).path !== "string" ||
				typeof (input as Record<string, unknown>).cursor !== "string"
			) {
				throw new Error("read_large_file requires string path and cursor fields.");
			}
			return await workflow.readNext(
				(input as Record<string, unknown>).path as string,
				options.contextWindow,
				(input as Record<string, unknown>).cursor as string,
			);
		},
	};
}
