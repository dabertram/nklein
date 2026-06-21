import type { PendingPromptsRuntimeService, PendingPromptsServiceApi, RuntimeHost, SessionModelRuntimeService, SessionUsageRuntimeService } from "../runtime/host/runtime-host";
import { type NKleinCoreSettingsApi } from "../settings";
export type RuntimeHostServiceExtensions = RuntimeHost & Partial<PendingPromptsRuntimeService & SessionUsageRuntimeService & SessionModelRuntimeService>;
export declare function createNKleinCoreSettingsApi(host: RuntimeHost): NKleinCoreSettingsApi;
export declare function createNKleinCorePendingPromptsApi(host: RuntimeHost): PendingPromptsServiceApi;
