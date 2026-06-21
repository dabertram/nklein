import type { AgentConfig, AgentModel, BasicLogger, ModelInfo } from "@nklein/shared";
export declare function resolveKnownModelsFromConfig(config: AgentConfig): Record<string, ModelInfo> | undefined;
export declare function createAgentModelFromConfig(config: AgentConfig, logger: BasicLogger | undefined): AgentModel;
