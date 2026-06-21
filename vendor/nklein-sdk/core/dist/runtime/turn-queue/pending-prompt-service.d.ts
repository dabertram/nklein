import type { CoreSessionEvent, SessionPendingPrompt } from "../../types/events";
import type { ActiveSession } from "../../types/session";
import type { PendingPromptMutationResult, PendingPromptsDeleteInput, PendingPromptsUpdateInput } from "../host/runtime-host";
export type PendingPromptDelivery = "queue" | "steer";
export interface PendingPromptEntry {
    id: string;
    prompt: string;
    delivery: PendingPromptDelivery;
    userImages?: string[];
    userFiles?: string[];
}
export interface PendingPromptQueueState {
    pendingPrompts: PendingPromptEntry[];
}
export interface PendingPromptsControllerDeps {
    getSession(sessionId: string): ActiveSession | undefined;
    emit(event: CoreSessionEvent): void;
    send(input: {
        sessionId: string;
        prompt: string;
        userImages?: string[];
        userFiles?: string[];
    }): Promise<unknown>;
}
export interface PendingPromptEnqueueInput {
    prompt: string;
    delivery: PendingPromptDelivery;
    userImages?: string[];
    userFiles?: string[];
}
export interface PendingPromptConsumeResult {
    entry?: PendingPromptEntry;
    prompts: SessionPendingPrompt[];
}
export declare class PendingPromptService {
    list(state: PendingPromptQueueState | undefined): SessionPendingPrompt[];
    update(state: PendingPromptQueueState | undefined, input: PendingPromptsUpdateInput): PendingPromptMutationResult;
    delete(state: PendingPromptQueueState | undefined, input: PendingPromptsDeleteInput): PendingPromptMutationResult;
    enqueue(state: PendingPromptQueueState, input: PendingPromptEnqueueInput): SessionPendingPrompt[];
    consumeSteer(state: PendingPromptQueueState): PendingPromptConsumeResult;
    shiftNext(state: PendingPromptQueueState): PendingPromptConsumeResult;
    requeueFront(state: PendingPromptQueueState, entry: PendingPromptEntry): SessionPendingPrompt[];
    clear(state: PendingPromptQueueState): SessionPendingPrompt[];
}
export declare class PendingPromptsController {
    private readonly deps;
    private readonly service;
    constructor(deps: PendingPromptsControllerDeps);
    list(sessionId: string): SessionPendingPrompt[];
    update(input: PendingPromptsUpdateInput): PendingPromptMutationResult;
    delete(input: PendingPromptsDeleteInput): PendingPromptMutationResult;
    enqueue(sessionId: string, entry: {
        prompt: string;
        delivery: "queue" | "steer";
        userImages?: string[];
        userFiles?: string[];
    }): void;
    consumeSteer(sessionId: string): string | undefined;
    clearAborted(session: ActiveSession): void;
    emitPrompts(session: ActiveSession): void;
    scheduleDrain(sessionId: string, session: ActiveSession): void;
    drain(sessionId: string): Promise<void>;
    private emitSubmitted;
}
