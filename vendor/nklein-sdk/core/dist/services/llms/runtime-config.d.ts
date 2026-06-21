import type { LlmsConfig } from "./runtime-types";
export declare function defineLlmsConfig(config: LlmsConfig): LlmsConfig;
export declare function loadLlmsConfigFromFile(configPath: string): Promise<LlmsConfig>;
