import type { FocusChainStepTouchDelta } from "../core/focus-chain";
import { normalizeTaskIdForSandboxPath, stripRedundantSandboxWorkdirPrefix } from "./nklein-agent-sandbox-task-path";
import { parseApplyPatchTargets } from "./nklein-apply-patch-targets";
import { readAgentEvent } from "./nklein-event-adapter-readers";
import { readToolResult } from "./nklein-message-content-readers";
import { parseReadFileRequests } from "./nklein-read-file-request";
import { asRecord } from "./nklein-value-guards";

export interface ExtractFocusChainTouchDeltaOptions {
	lookupToolInput?: (toolCallId: string) => unknown;
}

function normalizeToolName(toolName: string | null | undefined): string {
	return typeof toolName === "string"
		? toolName
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "")
		: "";
}

function dedupe(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function maybeParseJson(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
		return value;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function outputIndicatesFailure(output: unknown): boolean {
	const parsed = maybeParseJson(output);
	if (Array.isArray(parsed)) {
		return parsed.some(outputIndicatesFailure);
	}
	const record = asRecord(parsed);
	if (!record) {
		return false;
	}
	if (record.ok === false || record.success === false) {
		return true;
	}
	const error = record.error;
	return typeof error === "string" && error.trim().length > 0;
}

function readPath(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	for (const key of ["path", "file_path", "filePath", "filename"] as const) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	return null;
}

function extractPathValues(input: unknown): string[] {
	const paths: string[] = [];
	for (const request of parseReadFileRequests(input)) {
		paths.push(request.path);
	}
	const directPath = readPath(input);
	if (directPath) {
		paths.push(directPath);
	}
	const record = asRecord(input);
	if (record) {
		for (const key of ["files", "file_paths", "paths"] as const) {
			const value = record[key];
			if (Array.isArray(value)) {
				for (const item of value) {
					const path = readPath(item);
					if (path) {
						paths.push(path);
					}
				}
			} else {
				const path = readPath(value);
				if (path) {
					paths.push(path);
				}
			}
		}
	}
	return dedupe(paths);
}

function normalizeTouchedPath(taskId: string, rawPath: string): string | null {
	if (rawPath.includes("\0")) {
		return null;
	}
	const taskSegment = normalizeTaskIdForSandboxPath(taskId);
	let path = stripRedundantSandboxWorkdirPrefix(rawPath.replaceAll("\\", "/").trim(), taskId).replaceAll("\\", "/");
	const absoluteSandboxPrefix = `/workspaces/${taskSegment}/`;
	if (path.startsWith(absoluteSandboxPrefix)) {
		path = path.slice(absoluteSandboxPrefix.length);
	}
	while (path.startsWith("./")) {
		path = path.slice(2);
	}
	if (!path || path === "." || path === ".." || path.startsWith("../") || path.startsWith("/")) {
		return null;
	}
	return path;
}

function normalizeTouchedPaths(taskId: string, rawPaths: readonly string[]): string[] {
	return dedupe(
		rawPaths.map((path) => normalizeTouchedPath(taskId, path)).filter((path): path is string => path !== null),
	);
}

function applyPatchInput(input: unknown): unknown {
	const record = asRecord(input);
	if (!record) {
		return input;
	}
	if (typeof record.input === "string") {
		return input;
	}
	if (typeof record.patch === "string") {
		return { input: record.patch };
	}
	if (typeof record.diff === "string") {
		return { input: record.diff };
	}
	return input;
}

function fileTouchesFromTool(taskId: string, toolName: string, input: unknown): string[] {
	const normalized = normalizeToolName(toolName);
	const rawPaths =
		normalized === "applypatch" || normalized === "applydiff" || normalized === "patch"
			? parseApplyPatchTargets(applyPatchInput(input)).map((target) => target.path)
			: new Set([
						"read",
						"readfile",
						"readfiles",
						"readlargefile",
						"getfilesize",
						"writefile",
						"writefiles",
						"editfile",
						"editor",
					]).has(normalized)
				? extractPathValues(input)
				: [];
	return normalizeTouchedPaths(taskId, rawPaths);
}

function normalizeCardIds(values: readonly unknown[]): string[] {
	return dedupe(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()));
}

function cardTouchesFromOutput(taskId: string, toolName: string, output: unknown): string[] {
	const normalized = normalizeToolName(toolName);
	const parsed = maybeParseJson(output);
	const record = asRecord(parsed);
	if (!record) {
		return [];
	}
	if (normalized === "decomposeproject") {
		const ids: unknown[] = [];
		const taskIdByPlanTaskId = asRecord(record.taskIdByPlanTaskId);
		if (taskIdByPlanTaskId) {
			ids.push(...Object.values(taskIdByPlanTaskId));
		}
		if (Array.isArray(record.rootTaskIds)) {
			ids.push(...record.rootTaskIds);
		}
		if (Array.isArray(record.createdTasks)) {
			for (const task of record.createdTasks) {
				const taskRecord = asRecord(task);
				if (taskRecord) {
					ids.push(taskRecord.id);
				}
			}
		}
		return normalizeCardIds(ids);
	}
	if (normalized === "beginimplementation" && record.ok === true && record.promoted !== false) {
		return [taskId];
	}
	return [];
}

export function extractFocusChainTouchDeltaFromToolResult(
	taskId: string,
	toolName: string | null,
	input: unknown,
	output: unknown,
): FocusChainStepTouchDelta {
	if (!toolName || outputIndicatesFailure(output)) {
		return {};
	}
	const files = fileTouchesFromTool(taskId, toolName, input);
	const cardIds = cardTouchesFromOutput(taskId, toolName, output);
	return {
		...(files.length > 0 ? { files } : {}),
		...(cardIds.length > 0 ? { cardIds } : {}),
	};
}

export function extractFocusChainTouchDeltaFromSdkEvent(
	taskId: string,
	event: unknown,
	options: ExtractFocusChainTouchDeltaOptions = {},
): FocusChainStepTouchDelta {
	const agentEvent = readAgentEvent(event);
	if (!agentEvent) {
		return {};
	}
	if (agentEvent.type === "content_end" && agentEvent.contentType === "tool") {
		const toolError = "error" in agentEvent ? agentEvent.error : null;
		if (toolError !== null && toolError !== undefined && String(toolError).trim().length > 0) {
			return {};
		}
		const toolName = typeof agentEvent.toolName === "string" ? agentEvent.toolName : null;
		const toolCallId = typeof agentEvent.toolCallId === "string" ? agentEvent.toolCallId : null;
		const eventRecord = asRecord(agentEvent);
		const input = toolCallId ? (options.lookupToolInput?.(toolCallId) ?? eventRecord?.input) : eventRecord?.input;
		return extractFocusChainTouchDeltaFromToolResult(taskId, toolName, input, agentEvent.output);
	}
	if (agentEvent.type === "tool-finished") {
		const toolCall = asRecord(agentEvent.toolCall);
		const toolName = typeof toolCall?.toolName === "string" ? toolCall.toolName : null;
		const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : null;
		const { output, error } = readToolResult(agentEvent.message);
		if (error) {
			return {};
		}
		const input = toolCallId ? (options.lookupToolInput?.(toolCallId) ?? toolCall?.input) : toolCall?.input;
		return extractFocusChainTouchDeltaFromToolResult(taskId, toolName, input, output);
	}
	return {};
}
