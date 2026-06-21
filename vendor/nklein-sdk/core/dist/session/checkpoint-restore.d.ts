import type * as LlmsProviders from "@nklein/llms";
import type { CheckpointEntry, CheckpointMetadata } from "../hooks/checkpoint-hooks";
import type { SessionRecord } from "../types/sessions";
export interface CheckpointRestorePlan {
    checkpoint: CheckpointEntry;
    messages?: LlmsProviders.Message[];
    cwd: string;
}
export declare function readSessionCheckpointHistory(session: Pick<SessionRecord, "metadata"> | undefined): CheckpointEntry[];
export declare function createRestoredCheckpointMetadata(session: Pick<SessionRecord, "metadata"> | undefined, runCount: number): CheckpointMetadata | undefined;
export declare function trimMessagesToCheckpoint(messages: LlmsProviders.Message[], runCount: number): LlmsProviders.Message[];
export declare function trimMessagesBeforeCheckpoint(messages: LlmsProviders.Message[], runCount: number): LlmsProviders.Message[];
export declare function createCheckpointRestorePlan(input: {
    session: SessionRecord;
    messages?: LlmsProviders.Message[];
    checkpointRunCount: number;
    cwd?: string;
    restoreMessages?: boolean;
}): CheckpointRestorePlan;
export declare function applyCheckpointToWorktree(cwd: string, checkpoint: CheckpointEntry): Promise<void>;
