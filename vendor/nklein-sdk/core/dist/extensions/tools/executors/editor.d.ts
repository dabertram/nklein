/**
 * Editor Executor
 *
 * Built-in implementation for filesystem editing operations.
 */
import type { EditorExecutor } from "../types";
/**
 * Options for the editor executor
 */
export interface EditorExecutorOptions {
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
    /**
     * Maximum number of diff lines in str_replace output
     * @default 200
     */
    maxDiffLines?: number;
}
/**
 * Create an editor executor using Node.js fs module
 */
export declare function createEditorExecutor(options?: EditorExecutorOptions): EditorExecutor;
