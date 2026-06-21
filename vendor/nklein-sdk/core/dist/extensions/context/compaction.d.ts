import type { CoreCompactionContext, CoreSessionConfig } from "../../types/config";
export interface ContextPipelinePrepareTurnInput {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    messages: CoreCompactionContext["messages"];
    apiMessages: CoreCompactionContext["messages"];
    abortSignal: AbortSignal;
    systemPrompt: string;
    tools: unknown[];
    model: CoreCompactionContext["model"];
    emitStatusNotice?: (message: string, metadata?: Record<string, unknown>) => void;
}
export interface ContextPipelinePrepareTurnResult {
    messages: CoreCompactionContext["messages"];
    systemPrompt?: string;
}
export declare function createContextCompactionPrepareTurn(config: Pick<CoreSessionConfig, "providerConfig" | "providerId" | "modelId" | "compaction" | "logger">): ((context: ContextPipelinePrepareTurnInput) => Promise<ContextPipelinePrepareTurnResult | undefined>) | undefined;
