import type { RuntimeTaskImage, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "../core/api-contract";
import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";
import { CONTEXT_BUDGET_SEND_RESERVE_TOKENS } from "./nklein-context-budget-plan";
import { estimateNextPromptTokens } from "./nklein-context-budget-tokens";
import { countKanbanPersistedMessagesTokens } from "./nklein-context-focus-policy";
import {
	compactPersistedMessagesForContextOverflow,
	isContextOverflowError,
} from "./nklein-context-overflow-compaction";
import type { NKleinTaskLaunchConfigOverrides, NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import type { NKleinPersistedTaskSessionSnapshot } from "./nklein-session-runtime";
import { type NKleinTaskSessionEntry, updateSummary } from "./nklein-session-state";
import { toErrorMessage } from "./nklein-task-session-helpers";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary.js";

/** Above this projected-usage ratio the send warns the operator; above the compact ratio it proactively compacts. */
const CONTEXT_BUDGET_WARNING_RATIO = 0.8;
const CONTEXT_BUDGET_COMPACT_RATIO = 0.92;

/** The uniform outcome of a recovered/compacted send: the completed (re)started session's result + warnings. */
type RestartOutcome = { result: unknown; warnings?: string[] };

export interface ContextOverflowControllerDeps {
	recordObservationWithModel(event: SelfObservationEventInput & { taskId: string }): void;
	readPersistedTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null>;
	resolvePersistedLaunchConfig(input: {
		taskId: string;
		persistedSnapshot?: NKleinPersistedTaskSessionSnapshot | null;
	}): NKleinTaskRestartLaunchConfig | null;
	stopTaskSession(taskId: string): Promise<unknown>;
	canRestartTaskSession(taskId: string): boolean;
	waitUntilTaskResumed(taskId: string): Promise<void>;
	markStarted(taskId: string): void;
	/** Restart the live session in place with compacted history (wires onTeamEvent service-side). */
	restartTaskSession(input: {
		taskId: string;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		initialMessages: NKleinSdkPersistedMessage[];
		launchConfigOverrides?: NKleinTaskRestartLaunchConfig;
		cwd?: string | null;
	}): Promise<RestartOutcome>;
	/** Rebuild a fresh session from the persisted launch config (used when no live session can be restarted). */
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	prepareMessagesForKnownContextWindow(input: {
		taskId: string;
		messages?: NKleinSdkPersistedMessage[] | null;
		prompt: string;
		images?: RuntimeTaskImage[];
		contextWindow: number;
	}): NKleinSdkPersistedMessage[] | undefined;
	emitSummary(summary: RuntimeTaskSessionSummary): void;
}

export interface ContextOverflowController {
	/** Reactive recovery: if `error` is a provider context-overflow, compact history and re-drive; else null. */
	recoverAfterOverflow(input: {
		taskId: string;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		error: unknown;
	}): Promise<RestartOutcome | null>;
	/** Proactive guard: compact + re-drive BEFORE dispatch when the projected budget is over the compact ratio. */
	compactBeforeOverflow(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides;
		contextWindow: number;
	}): Promise<RestartOutcome | null>;
}

/**
 * §5.U: owns the context-overflow recovery pair — the REACTIVE retry after a provider context-overflow error and the
 * PROACTIVE pre-send compaction guard. Both compact the persisted history then re-drive the task, sharing the identical
 * "restart the live session, else rebuild from the launch config, else throw" tail (`restartOrStartWithMessages`).
 * Extracted verbatim from InMemoryNKleinTaskSessionService; the service supplies session-lifecycle accessors as deps.
 */
export function createContextOverflowController(deps: ContextOverflowControllerDeps): ContextOverflowController {
	/**
	 * Shared tail: restart the live session in place if it can be restarted, otherwise rebuild a fresh session from
	 * the persisted launch config, otherwise throw (no config to recover from). Behavior-identical across both entry
	 * points — the callers differ only in when they stop the session / resolve the launch config beforehand.
	 */
	async function restartOrStartWithMessages(input: {
		taskId: string;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		compactedMessages: NKleinSdkPersistedMessage[];
		restartLaunchConfig: NKleinTaskRestartLaunchConfig | null;
		cwd: string | null | undefined;
	}): Promise<RestartOutcome> {
		if (deps.canRestartTaskSession(input.taskId)) {
			await deps.waitUntilTaskResumed(input.taskId);
			deps.markStarted(input.taskId);
			const restartedSession = await deps.restartTaskSession({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: input.compactedMessages,
				launchConfigOverrides: input.restartLaunchConfig ?? undefined,
				cwd: input.cwd,
			});
			return { result: restartedSession.result, warnings: restartedSession.warnings };
		}
		if (input.restartLaunchConfig && input.cwd) {
			return await deps.startRuntimeSession({
				taskId: input.taskId,
				cwd: input.cwd,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: input.compactedMessages,
				launchConfig: input.restartLaunchConfig,
			});
		}
		throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
	}

	async function recoverAfterOverflow(input: {
		taskId: string;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		error: unknown;
	}): Promise<RestartOutcome | null> {
		if (!isContextOverflowError(input.error)) {
			return null;
		}
		deps.recordObservationWithModel({
			signal: "context_overflow",
			severity: "warning",
			message: toErrorMessage(input.error),
			taskId: input.taskId,
			metadata: {
				mode: input.mode,
			},
		});

		const persistedSnapshot = await deps.readPersistedTaskSession(input.taskId).catch(() => null);
		const compactedMessages = compactPersistedMessagesForContextOverflow(persistedSnapshot?.messages ?? []);
		if (!compactedMessages) {
			return null;
		}
		const restartLaunchConfig = deps.resolvePersistedLaunchConfig({
			taskId: input.taskId,
			persistedSnapshot,
		});

		await deps.stopTaskSession(input.taskId).catch(() => null);
		return await restartOrStartWithMessages({
			taskId: input.taskId,
			prompt: input.prompt,
			mode: input.mode,
			images: input.images,
			compactedMessages,
			restartLaunchConfig,
			cwd: persistedSnapshot?.record.cwd,
		});
	}

	async function compactBeforeOverflow(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides;
		contextWindow: number;
	}): Promise<RestartOutcome | null> {
		const nextPromptTokens = estimateNextPromptTokens(input.prompt, input.images);
		const persistedSnapshot = await deps.readPersistedTaskSession(input.taskId).catch(() => null);
		const compactedMessages = deps.prepareMessagesForKnownContextWindow({
			taskId: input.taskId,
			messages: persistedSnapshot?.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow: input.contextWindow,
		});
		const projectedTokens =
			(compactedMessages ? countKanbanPersistedMessagesTokens(compactedMessages) : 0) +
			nextPromptTokens +
			CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
		const usageRatio = projectedTokens / input.contextWindow;

		if (usageRatio >= CONTEXT_BUDGET_WARNING_RATIO) {
			deps.emitSummary(
				updateSummary(input.entry, {
					warningMessage: `Context budget high (~${Math.round(usageRatio * 100)}%). Consider summarizing chat or narrowing scope.`,
				}),
			);
		}

		if (!compactedMessages) {
			return null;
		}

		const originalMessages = persistedSnapshot?.messages ?? [];
		if (compactedMessages === originalMessages && usageRatio < CONTEXT_BUDGET_COMPACT_RATIO) {
			return null;
		}

		await deps.stopTaskSession(input.taskId).catch(() => null);
		const restartLaunchConfig =
			input.launchConfigOverrides ??
			deps.resolvePersistedLaunchConfig({
				taskId: input.taskId,
				persistedSnapshot,
			});
		return await restartOrStartWithMessages({
			taskId: input.taskId,
			prompt: input.prompt,
			mode: input.mode,
			images: input.images,
			compactedMessages,
			restartLaunchConfig,
			cwd: persistedSnapshot?.record.cwd,
		});
	}

	return { recoverAfterOverflow, compactBeforeOverflow };
}
