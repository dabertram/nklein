/**
 * AgentRuntime contract types, integrated into this codebase from the formerly-vendored SDK
 * (`@nklein/shared` ⇐ Cline's `@clinebot/shared`). The vendored package shipped only prebuilt
 * (minified) dist with no source; these are the canonical, pure type definitions the agent runtime
 * + tools consume. Self-contained (the runtime-config/model-request types that referenced external
 * llms/logger types were not used by this app and are omitted — carve back out into an SDK later if
 * one is reintroduced).
 */

export interface AgentTextPart {
	type: "text";
	text: string;
}
export interface AgentReasoningPart {
	type: "reasoning";
	text: string;
	redacted?: boolean;
	metadata?: unknown;
}
export interface AgentImagePart {
	type: "image";
	image: string | Uint8Array | ArrayBuffer | URL;
	mediaType?: string;
}
export interface AgentFilePart {
	type: "file";
	path: string;
	content: string;
}
export interface AgentToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
	metadata?: unknown;
}
export interface AgentToolResultPart {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: unknown;
	isError?: boolean;
}
export type AgentMessagePart =
	| AgentTextPart
	| AgentReasoningPart
	| AgentImagePart
	| AgentFilePart
	| AgentToolCallPart
	| AgentToolResultPart;
export type AgentMessageRole = "user" | "assistant" | "tool";
export interface AgentTokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}
export interface AgentUsage extends AgentTokenUsage {
	totalCost?: number;
}
export interface AgentMessage {
	id: string;
	role: AgentMessageRole;
	content: AgentMessagePart[];
	createdAt: number;
	metadata?: Record<string, unknown>;
	modelInfo?: {
		id: string;
		provider: string;
		family?: string;
	};
	metrics?: AgentTokenUsage & {
		cost?: number;
	};
}
export type AgentRole = string;
export type AgentRunStatus = "idle" | "running" | "completed" | "aborted" | "failed";
export interface AgentRuntimeStateSnapshot {
	agentId: string;
	agentRole?: AgentRole;
	parentAgentId?: string | null;
	conversationId?: string;
	runId?: string;
	status: AgentRunStatus;
	iteration: number;
	messages: readonly AgentMessage[];
	pendingToolCalls: readonly string[];
	usage: AgentUsage;
	lastError?: string;
}
export interface AgentToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	lifecycle?: {
		/** Whether a successful call to this tool completes the current run. */
		completesRun?: boolean;
	};
}
export interface AgentToolResult<TOutput = unknown> {
	output: TOutput;
	isError?: boolean;
	metadata?: Record<string, unknown>;
}
export interface AgentToolContext {
	sessionId?: string;
	agentId: string;
	conversationId?: string;
	runId?: string;
	iteration: number;
	toolCallId?: string;
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
	snapshot?: AgentRuntimeStateSnapshot;
	emitUpdate?: (update: unknown) => void;
}
export interface AgentTool<TInput = unknown, TOutput = unknown> extends AgentToolDefinition {
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
	execute: (input: TInput, context: AgentToolContext) => Promise<TOutput> | TOutput;
}
export interface AgentModelRequest {
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools: readonly AgentToolDefinition[];
	signal?: AbortSignal;
	options?: Record<string, unknown>;
}
export type AgentModelFinishReason = "stop" | "tool-calls" | "max-tokens" | "aborted" | "error";
export interface AgentBeforeModelContext {
	snapshot: AgentRuntimeStateSnapshot;
	request: AgentModelRequest;
}
export interface AgentStopControl {
	stop?: boolean;
	reason?: string;
}
export interface AgentBeforeModelResult {
	stop?: boolean;
	reason?: string;
	messages?: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	options?: Record<string, unknown>;
}
export interface AgentAfterModelContext {
	snapshot: AgentRuntimeStateSnapshot;
	assistantMessage: AgentMessage;
	finishReason: AgentModelFinishReason;
}
export interface AgentBeforeToolContext {
	snapshot: AgentRuntimeStateSnapshot;
	tool: AgentTool;
	toolCall: AgentToolCallPart;
	input: unknown;
}
export interface AgentBeforeToolResult {
	skip?: boolean;
	stop?: boolean;
	reason?: string;
	input?: unknown;
}
export interface AgentAfterToolContext {
	snapshot: AgentRuntimeStateSnapshot;
	tool: AgentTool;
	toolCall: AgentToolCallPart;
	input: unknown;
	result: AgentToolResult;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
}
export interface AgentAfterToolResult {
	stop?: boolean;
	reason?: string;
	result?: AgentToolResult;
}
