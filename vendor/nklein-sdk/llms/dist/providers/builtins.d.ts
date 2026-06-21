import type { GatewayProviderManifest, GatewayProviderMetadata, GatewayProviderSettings, ProviderCapability } from "@nklein/shared";
import type { ModelCollection, ModelInfo, ProviderClient, ProviderProtocol } from "../catalog/types";
export declare const DEFAULT_INTERNAL_OCA_BASE_URL = "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export declare const DEFAULT_EXTERNAL_OCA_BASE_URL = "https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export type ProviderFamily = "openai" | "openai-compatible" | "anthropic" | "google" | "vertex" | "bedrock" | "mistral" | "claude-code" | "openai-codex" | "opencode" | "dify";
export interface BuiltinSpec {
    id: string;
    name: string;
    description: string;
    family: ProviderFamily;
    protocol?: ProviderProtocol;
    client?: ProviderClient;
    capabilities?: ProviderCapability[];
    modelsProviderId?: string;
    defaultModelId?: string;
    modelsFactory?: () => Record<string, ModelInfo>;
    env?: readonly ("browser" | "node")[];
    apiKeyEnv?: readonly string[];
    modelsSourceUrl?: string;
    docsUrl?: string;
    defaults?: GatewayProviderSettings;
    metadata?: GatewayProviderMetadata;
}
export declare const BUILTIN_SPECS: BuiltinSpec[];
export declare function toManifest(spec: BuiltinSpec): GatewayProviderManifest;
export declare const BUILTIN_PROVIDER_COLLECTION_LIST: ModelCollection[];
export declare const BUILTIN_PROVIDER_COLLECTIONS_BY_ID: Record<string, ModelCollection>;
//# sourceMappingURL=builtins.d.ts.map