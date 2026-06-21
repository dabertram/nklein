import type { CoreSettingsListInput, CoreSettingsMutationResult, CoreSettingsSnapshot, CoreSettingsToggleInput } from "./types";
export declare class CoreSettingsService {
    list(input?: CoreSettingsListInput): Promise<CoreSettingsSnapshot>;
    toggle(input: CoreSettingsToggleInput): Promise<CoreSettingsMutationResult>;
}
export declare function createCoreSettingsService(): CoreSettingsService;
