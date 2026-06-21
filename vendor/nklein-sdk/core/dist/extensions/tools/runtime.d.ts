import type { CoreAgentMode } from "../../types/config";
export interface ToolCatalogEntry {
    id: string;
    description: string;
    defaultEnabled: boolean;
    headlessToolNames: string[];
}
export interface BuiltinToolAvailabilityContext {
    mode?: CoreAgentMode;
    providerId?: string;
    modelId?: string;
    enableSpawnAgent?: boolean;
    enableAgentTeams?: boolean;
    disabledToolIds?: ReadonlySet<string>;
}
export declare function getCoreBuiltinToolCatalog(context?: BuiltinToolAvailabilityContext): ToolCatalogEntry[];
export declare function getCoreDefaultEnabledToolIds(context?: BuiltinToolAvailabilityContext): string[];
export declare function resolveCoreSelectedToolIds(input: {
    enabled: boolean;
    allowlist?: string[];
    availabilityContext?: BuiltinToolAvailabilityContext;
}): Set<string>;
export declare function getCoreHeadlessToolNames(selectedToolIds: ReadonlySet<string>, context?: BuiltinToolAvailabilityContext): string[];
export declare function getCoreAcpToolNames(selectedToolIds: ReadonlySet<string>, context?: BuiltinToolAvailabilityContext): string[];
