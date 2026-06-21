/**
 * AgentTool Presets
 *
 * Pre-configured tool combinations for common use cases.
 */
import type { AgentMode, AgentTool, ToolPolicy } from "@nklein/shared";
import type { CreateDefaultToolsOptions, DefaultToolsConfig } from "./types";
export interface ToolPresetConfig extends DefaultToolsConfig {
    enableSpawnAgent?: boolean;
    enableAgentTeams?: boolean;
}
/**
 * Preset configurations for common use cases
 */
export declare const ToolPresets: {
    /**
     * Act mode (full development tools)
     * Good for coding assistants and task automation
     */
    readonly act: {
        readonly enableReadFiles: true;
        readonly enableSearch: true;
        readonly enableBash: true;
        readonly enableWebFetch: true;
        readonly enableApplyPatch: false;
        readonly enableEditor: true;
        readonly enableSkills: true;
        readonly enableAskQuestion: true;
        readonly enableSubmitAndExit: false;
        readonly enableSpawnAgent: true;
        readonly enableAgentTeams: true;
    };
    /**
     * Plan mode (read-only, no shell access)
     * Good for analysis and documentation agents
     */
    readonly plan: {
        readonly enableReadFiles: true;
        readonly enableSearch: true;
        readonly enableBash: true;
        readonly enableWebFetch: true;
        readonly enableApplyPatch: false;
        readonly enableEditor: false;
        readonly enableSkills: true;
        readonly enableAskQuestion: true;
        readonly enableSubmitAndExit: false;
        readonly enableSpawnAgent: true;
        readonly enableAgentTeams: true;
    };
    /**
     * Search-focused tools (read_files + search_codebase)
     * Good for code exploration and analysis agents
     */
    readonly search: {
        readonly enableReadFiles: true;
        readonly enableSearch: true;
        readonly enableBash: false;
        readonly enableWebFetch: false;
        readonly enableApplyPatch: false;
        readonly enableEditor: false;
        readonly enableSkills: false;
        readonly enableAskQuestion: false;
        readonly enableSubmitAndExit: false;
        readonly enableSpawnAgent: true;
        readonly enableAgentTeams: true;
    };
    /**
     * Minimal tools for focused tasks
     */
    readonly minimal: {
        readonly enableReadFiles: false;
        readonly enableSearch: false;
        readonly enableBash: true;
        readonly enableWebFetch: false;
        readonly enableApplyPatch: false;
        readonly enableEditor: false;
        readonly enableSkills: false;
        readonly enableAskQuestion: false;
        readonly enableSubmitAndExit: false;
        readonly enableSpawnAgent: true;
        readonly enableAgentTeams: false;
    };
    /**
     * YOLO mode (automation-focused tools + no approval required)
     * Good for trusted local automation workflows.
     */
    readonly yolo: {
        readonly enableReadFiles: true;
        readonly enableSearch: true;
        readonly enableBash: true;
        readonly enableWebFetch: true;
        readonly enableApplyPatch: false;
        readonly enableEditor: true;
        readonly enableSkills: true;
        readonly enableAskQuestion: false;
        readonly enableSubmitAndExit: true;
        readonly enableSpawnAgent: false;
        readonly enableAgentTeams: false;
    };
};
/**
 * Type for preset names
 */
export type ToolPresetName = keyof typeof ToolPresets;
export declare function resolveToolPresetName(options: {
    mode?: AgentMode;
}): ToolPresetName;
/**
 * AgentTool policy preset names
 */
export type ToolPolicyPresetName = "default" | "yolo";
/**
 * Build tool policies for a preset.
 * `yolo` guarantees tool policies are enabled and auto-approved.
 */
export declare function createToolPoliciesWithPreset(presetName: ToolPolicyPresetName): Record<string, ToolPolicy>;
/**
 * Create default tools using a preset configuration
 *
 * @example
 * ```typescript
 * const tools = createDefaultToolsWithPreset("plan", {
 *   executors: {
 *     readFile: async ({ path }) => fs.readFile(path, "utf-8"),
 *     search: async (query, cwd) => searchFiles(query, cwd),
 *     webFetch: async (url, prompt) => fetchAndAnalyze(url, prompt),
 *   },
 *   cwd: "/path/to/project",
 * })
 * ```
 */
export declare function createDefaultToolsWithPreset(presetName: ToolPresetName, options: Omit<CreateDefaultToolsOptions, keyof DefaultToolsConfig> & Partial<DefaultToolsConfig>): AgentTool[];
