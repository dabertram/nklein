/**
 * Built-in Executor Implementations
 *
 * This module provides ready-to-use implementations of the tool executors
 * using Node.js built-in modules. These can be used directly or as references
 * for custom implementations.
 */
import type { ToolExecutors } from "../types";
import { type ApplyPatchExecutorOptions } from "./apply-patch";
import { type BashExecutorOptions } from "./bash";
import { type EditorExecutorOptions } from "./editor";
import { type FileReadExecutorOptions } from "./file-read";
import { type SearchExecutorOptions } from "./search";
import { type WebFetchExecutorOptions } from "./web-fetch";
export { type ApplyPatchExecutorOptions, createApplyPatchExecutor, } from "./apply-patch";
export { type BashExecutorOptions, createBashExecutor, } from "./bash";
export { createEditorExecutor, type EditorExecutorOptions } from "./editor";
export { createFileReadExecutor, type FileReadExecutorOptions, } from "./file-read";
export { createSearchExecutor, type SearchExecutorOptions } from "./search";
export { createWebFetchExecutor, type WebFetchExecutorOptions, } from "./web-fetch";
/**
 * Options for creating default executors
 */
export interface DefaultExecutorsOptions {
    fileRead?: FileReadExecutorOptions;
    search?: SearchExecutorOptions;
    bash?: BashExecutorOptions;
    webFetch?: WebFetchExecutorOptions;
    applyPatch?: ApplyPatchExecutorOptions;
    editor?: EditorExecutorOptions;
}
/**
 * Create all default executors with optional configuration
 *
 * @example
 * ```typescript
 * import { createDefaultTools, createDefaultExecutors } from "@nklein/core"
 *
 * const executors = createDefaultExecutors({
 *   bash: { timeoutMs: 60000 },
 *   search: { maxResults: 50 },
 * })
 *
 * const tools = createDefaultTools({
 *   executors,
 *   cwd: "/path/to/project",
 * })
 * ```
 */
export declare function createDefaultExecutors(options?: DefaultExecutorsOptions): ToolExecutors;
