import type * as LlmsProviders from "@nklein/llms";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";
import type { SessionRecord } from "../types/sessions";
export interface CoreSessionCheckpointSnapshot {
    enabled?: boolean;
    latest?: CheckpointEntry;
    history: CheckpointEntry[];
}
export interface CoreSessionSnapshot {
    version: 1;
    sessionId: string;
    source: SessionRecord["source"];
    status: SessionRecord["status"];
    createdAt: string;
    updatedAt: string;
    endedAt?: string | null;
    exitCode?: number | null;
    interactive: boolean;
    workspace: {
        cwd: string;
        root: string;
    };
    model: {
        providerId: string;
        modelId: string;
    };
    capabilities: {
        enableTools: boolean;
        enableSpawn: boolean;
        enableTeams: boolean;
    };
    lineage: {
        parentSessionId?: string;
        parentAgentId?: string;
        agentId?: string;
        conversationId?: string;
        isSubagent: boolean;
    };
    team?: {
        name: string;
    };
    prompt?: string;
    metadata?: Record<string, unknown>;
    artifacts?: {
        messagesPath?: string;
    };
    messages?: LlmsProviders.Message[];
    usage?: SessionAccumulatedUsage;
    checkpoint?: CoreSessionCheckpointSnapshot;
}
export declare function createCoreSessionSnapshot(input: {
    session: SessionRecord;
    messages?: LlmsProviders.Message[];
    usage?: SessionAccumulatedUsage;
}): CoreSessionSnapshot;
export declare function coreSessionSnapshotToRecord(snapshot: CoreSessionSnapshot): SessionRecord;
