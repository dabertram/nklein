import type { AgentHooks, BasicLogger } from "@nklein/shared";
export interface CheckpointEntry {
    ref: string;
    createdAt: number;
    runCount: number;
    kind?: "stash" | "commit";
}
export interface CheckpointMetadata {
    latest: CheckpointEntry;
    history: CheckpointEntry[];
}
type CreateCheckpointHooksOptions = {
    cwd: string;
    sessionId: string;
    logger?: BasicLogger;
    readSessionMetadata: () => Promise<Record<string, unknown> | undefined>;
    writeSessionMetadata: (metadata: Record<string, unknown>) => Promise<void> | void;
    /**
     * Optional custom checkpoint implementation. When provided, the built-in
     * git stash/ref logic is skipped entirely and this function is called
     * instead. Return `undefined` to skip writing a checkpoint for that run.
     */
    createCheckpoint?: (context: {
        cwd: string;
        sessionId: string;
        runCount: number;
    }) => Promise<CheckpointEntry | undefined> | CheckpointEntry | undefined;
    /**
     * Starting value for the internal run counter. Use this when a session
     * is created with initial messages (e.g. after a checkpoint restore) so
     * that new checkpoint entries get runCount values that don't collide
     * with entries carried over from the source session.
     */
    initialRunCount?: number;
};
/**
 * Deletes all private git refs under refs/nklein/checkpoints/{sessionId}/ that
 * were created by the checkpoint system to keep stash objects reachable.
 * Errors are swallowed - if the cwd is not a git repo or the refs don't exist,
 * the delete is a no-op.
 */
export declare function deleteCheckpointRefs(cwd: string | null | undefined, sessionId: string): Promise<void>;
export declare function retainCheckpointRefs(cwd: string | null | undefined, sessionId: string, checkpoints: readonly CheckpointEntry[]): Promise<void>;
export declare function createCheckpointHooks(options: CreateCheckpointHooksOptions): AgentHooks;
export {};
