/**
 * Apply Patch Executor
 *
 * Built-in implementation for the documented GPT-5 apply_patch grammar.
 * It accepts the freeform patch body directly and tolerates the legacy shell
 * wrapper form used by older prompts.
 */
import type { ApplyPatchExecutor } from "../types";
/**
 * Options for the apply_patch executor
 */
export interface ApplyPatchExecutorOptions {
    /**
     * File encoding used for read/write operations
     * @default "utf-8"
     */
    encoding?: BufferEncoding;
    /**
     * Restrict relative-path file operations to paths inside cwd.
     * Absolute paths are always accepted as-is.
     * @default true
     */
    restrictToCwd?: boolean;
}
/**
 * Create an apply_patch executor using Node.js fs module.
 */
export declare function createApplyPatchExecutor(options?: ApplyPatchExecutorOptions): ApplyPatchExecutor;
