/**
 * Default AgentTool Definitions
 *
 * Factory functions for creating the default tools.
 */
import { type AgentTool } from "@nklein/shared";
import { type ApplyPatchInput, type AskQuestionInput, type EditFileInput, type FetchWebContentInput, type ReadFilesInput, type RunCommandsInput, type SearchCodebaseInput, type SkillsInput, type StructuredCommandInput, type SubmitInput } from "./schemas";
import type { ApplyPatchExecutor, AskQuestionExecutor, BashExecutor, CreateDefaultToolsOptions, DefaultToolsConfig, EditorExecutor, FileReadExecutor, SearchExecutor, SkillsExecutorWithMetadata, ToolOperationResult, VerifySubmitExecutor, WebFetchExecutor } from "./types";
/**
 * Create the read_files tool
 *
 * Reads the content of one or more files from the filesystem.
 */
export declare function createReadFilesTool(executor: FileReadExecutor, config?: Pick<DefaultToolsConfig, "fileReadTimeoutMs">): AgentTool<ReadFilesInput, ToolOperationResult[]>;
/**
 * Create the search_codebase tool
 *
 * Performs regex pattern searches across the codebase.
 */
export declare function createSearchTool(executor: SearchExecutor, config?: Pick<DefaultToolsConfig, "cwd" | "searchTimeoutMs">): AgentTool<SearchCodebaseInput, ToolOperationResult[]>;
/**
 * Create the run_commands tool
 *
 * Executes shell commands in the project directory.
 */
export declare function createBashTool(executor: BashExecutor, config?: Pick<DefaultToolsConfig, "cwd" | "bashTimeoutMs">): AgentTool<RunCommandsInput, ToolOperationResult[]>;
/**
 * Create the run_commands tool
 *
 * Executes shell commands in the project directory.
 */
export declare function createWindowsShellTool(executor: BashExecutor, config?: Pick<DefaultToolsConfig, "cwd" | "bashTimeoutMs">): AgentTool<StructuredCommandInput, ToolOperationResult[]>;
/**
 * Create the fetch_web_content tool
 *
 * Fetches content from URLs and analyzes them using provided prompts.
 */
export declare function createWebFetchTool(executor: WebFetchExecutor, config?: Pick<DefaultToolsConfig, "webFetchTimeoutMs">): AgentTool<FetchWebContentInput, ToolOperationResult[]>;
/**
 * Create the apply_patch tool
 *
 * Applies the canonical apply_patch format to one or more files.
 */
export declare function createApplyPatchTool(executor: ApplyPatchExecutor, config?: Pick<DefaultToolsConfig, "cwd" | "applyPatchTimeoutMs">): AgentTool<ApplyPatchInput, ToolOperationResult>;
/**
 * Create the editor tool
 *
 * Supports controlled filesystem edits with create, replace, and insert commands.
 */
export declare function createEditorTool(executor: EditorExecutor, config?: Pick<DefaultToolsConfig, "cwd" | "editorTimeoutMs">): AgentTool<EditFileInput, ToolOperationResult>;
/**
 * Create the skills tool
 *
 * Invokes a configured skill by name and optional arguments.
 */
export declare function createSkillsTool(executor: SkillsExecutorWithMetadata, config?: Pick<DefaultToolsConfig, "skillsTimeoutMs">): AgentTool<SkillsInput, string>;
/**
 * Create the ask_question tool
 *
 * Asks the user a single clarifying question with 2-5 selectable options.
 */
export declare function createAskQuestionTool(executor: AskQuestionExecutor): AgentTool<AskQuestionInput, string>;
export declare function createSubmitAndExitTool(executor: VerifySubmitExecutor, config?: Pick<DefaultToolsConfig, "submitTimeoutMs">): AgentTool<SubmitInput, string>;
/**
 * Create a set of default tools for an agent
 *
 * This function creates the default tools based on the provided configuration
 * and executors. Only tools that are enabled AND have an executor provided
 * will be included in the returned array.
 *
 * @example
 * ```typescript
 * import { Agent, createDefaultTools } from "@nklein/core"
 * import * as fs from "fs/promises"
 * import { exec } from "child_process"
 *
 * const tools = createDefaultTools({
 *   executors: {
 *     readFile: async ({ path }) => fs.readFile(path, "utf-8"),
 *     bash: async (cmd, cwd) => {
 *       return new Promise((resolve, reject) => {
 *         exec(cmd, { cwd }, (err, stdout, stderr) => {
 *           if (err) reject(new Error(stderr || err.message))
 *           else resolve(stdout)
 *         })
 *       })
 *     },
 *   },
 *   enableReadFiles: true,
 *   enableBash: true,
 *   enableSearch: false, // Disabled
 *   enableWebFetch: false, // Disabled
 *   cwd: "/path/to/project",
 * })
 *
 * const agent = new Agent({
 *   // ... provider config
 *   tools,
 * })
 * ```
 */
export declare function createDefaultTools(options: CreateDefaultToolsOptions): AgentTool[];
