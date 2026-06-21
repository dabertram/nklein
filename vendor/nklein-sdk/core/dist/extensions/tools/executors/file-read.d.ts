/**
 * File Read Executor
 *
 * Built-in implementation for reading files using Node.js fs module.
 */
import type { FileReadExecutor } from "../types";
/**
 * Options for the file read executor
 */
export interface FileReadExecutorOptions {
    /**
     * Maximum file size to read in bytes
     * @default 10_000_000 (10MB)
     */
    maxFileSizeBytes?: number;
    /**
     * File encoding
     * @default "utf-8"
     */
    encoding?: BufferEncoding;
    /**
     * Whether to include line numbers in output
     * @default false
     */
    includeLineNumbers?: boolean;
}
/**
 * Create a file read executor using Node.js fs module
 *
 * @example
 * ```typescript
 * const readFile = createFileReadExecutor({
 *   maxFileSizeBytes: 5_000_000, // 5MB limit
 *   includeLineNumbers: true,
 * })
 *
 * const content = await readFile({ path: "/path/to/file.ts" }, context)
 * ```
 */
export declare function createFileReadExecutor(options?: FileReadExecutorOptions): FileReadExecutor;
