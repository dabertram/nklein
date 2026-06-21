import type * as LlmsProviders from "@nklein/llms";
import type { CheckpointEntry, CheckpointMetadata } from "../hooks/checkpoint-hooks";
import type { RestoreSessionInput } from "../runtime/host/runtime-host";
import type { SessionRecord } from "../types/sessions";
import { type CheckpointRestorePlan } from "./checkpoint-restore";
import { type CoreSessionSnapshot } from "./session-snapshot";
export type SessionVersioningErrorCode = "invalid_restore" | "session_not_found" | "session_messages_not_found";
export declare class SessionVersioningError extends Error {
    readonly code: SessionVersioningErrorCode;
    constructor(code: SessionVersioningErrorCode, message: string);
}
export interface SessionCheckpointRestoreContext {
    sourceSession: SessionRecord;
    sourceMessages?: LlmsProviders.Message[];
    sourceSnapshot: CoreSessionSnapshot;
    plan: CheckpointRestorePlan;
    restoredCheckpointMetadata?: CheckpointMetadata;
    initialMessages: LlmsProviders.Message[];
    restoreMessages: boolean;
    restoreWorkspace: boolean;
    checkpointRunCount: number;
}
export interface SessionCheckpointRestoreResult<TStartResult = unknown> {
    sessionId?: string;
    startResult?: TStartResult;
    messages?: LlmsProviders.Message[];
    checkpoint: CheckpointEntry;
    sourceSnapshot: CoreSessionSnapshot;
    restoredSnapshot?: CoreSessionSnapshot;
}
export interface SessionCheckpointRestoreInput<TRestoreStartInput, TStartInput, TStartResult> {
    sessionId: string;
    checkpointRunCount: number;
    cwd?: string;
    restore?: RestoreSessionInput["restore"];
    start?: TRestoreStartInput;
    getSession(sessionId: string): Promise<SessionRecord | undefined>;
    readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
    buildStartInput?: (context: SessionCheckpointRestoreContext, start: TRestoreStartInput) => TStartInput | Promise<TStartInput>;
    startSession?: (input: TStartInput) => Promise<TStartResult>;
    getStartedSessionId?: (result: TStartResult) => string | undefined;
    readRestoredSession?: (sessionId: string) => Promise<SessionRecord | undefined>;
    applyWorkspaceCheckpoint?: (cwd: string, checkpoint: CheckpointEntry) => Promise<void>;
    retainCheckpointRefs?: (cwd: string, sessionId: string, history: CheckpointEntry[]) => Promise<void>;
}
export declare class SessionVersioningService {
    restoreCheckpoint<TRestoreStartInput, TStartInput, TStartResult>(input: SessionCheckpointRestoreInput<TRestoreStartInput, TStartInput, TStartResult>): Promise<SessionCheckpointRestoreResult<TStartResult>>;
}
