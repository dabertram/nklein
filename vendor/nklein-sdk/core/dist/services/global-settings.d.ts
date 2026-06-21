import type { AgentConfig, AgentTool, ITelemetryService } from "@nklein/shared";
import { z } from "zod";
export declare const GlobalSettingsSchema: z.ZodPipe<z.ZodObject<{
    telemetryOptOut: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
    disabledTools: z.ZodOptional<z.ZodPipe<z.ZodPreprocess<z.ZodOptional<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[] | undefined, string[] | undefined>>>;
    disabledPlugins: z.ZodOptional<z.ZodPipe<z.ZodPreprocess<z.ZodOptional<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[] | undefined, string[] | undefined>>>;
}, z.core.$strip>, z.ZodTransform<{
    telemetryOptOut: boolean;
    disabledTools?: string[];
    disabledPlugins?: string[];
}, {
    telemetryOptOut: boolean;
    disabledTools?: string[] | undefined;
    disabledPlugins?: string[] | undefined;
}>>;
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;
export interface WriteGlobalSettingsOptions {
    telemetry?: ITelemetryService;
}
export declare function readGlobalSettings(): GlobalSettings;
export declare function writeGlobalSettings(settings: z.input<typeof GlobalSettingsSchema>, options?: WriteGlobalSettingsOptions): void;
export declare function isTelemetryOptedOutGlobally(): boolean;
export declare function setTelemetryOptOutGlobally(telemetryOptOut: boolean, options?: WriteGlobalSettingsOptions): void;
export declare function resolveDisabledToolNames(disabledToolNames?: ReadonlyArray<string>): Set<string>;
export declare function resolveDisabledPluginPaths(disabledPluginPaths?: ReadonlyArray<string>): Set<string>;
export declare function isToolDisabledGlobally(toolName: string): boolean;
export declare function toggleDisabledTool(toolName: string): boolean;
export declare function setDisabledTools(toolNames: ReadonlyArray<string>, disabledValue: boolean): void;
export declare function setToolDisabledGlobally(toolName: string, disabled: boolean): boolean;
export declare function isPluginDisabledGlobally(pluginPath: string): boolean;
export declare function setDisabledPlugin(pluginPath: string, disabledValue: boolean): void;
export declare function filterDisabledPluginPaths(pluginPaths: ReadonlyArray<string>, disabledPluginPaths?: ReadonlyArray<string>): string[];
export declare function filterDisabledTools<T extends Pick<AgentTool, "name">>(tools: ReadonlyArray<T>, disabledToolNames?: ReadonlyArray<string>): T[];
export declare function filterExtensionToolRegistrations(extensions: AgentConfig["extensions"], disabledToolNames?: ReadonlyArray<string>): AgentConfig["extensions"];
