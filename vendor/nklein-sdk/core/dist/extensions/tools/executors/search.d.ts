/**
 * Search Executor
 *
 * Built-in implementation for searching the codebase using ripgrep (if available) or regex.
 */
import type { SearchExecutor } from "../types";
/**
 * Options for the search executor
 */
export interface SearchExecutorOptions {
    /**
     * File extensions to include in search (without dot)
     * @default common code extensions
     */
    includeExtensions?: string[];
    /**
     * Directories to exclude from search
     * @default ["node_modules", ".git", "dist", "build", ".next", "coverage"]
     */
    excludeDirs?: string[];
    /**
     * Maximum number of results to return
     * @default 100
     */
    maxResults?: number;
    /**
     * Number of context lines before and after match
     * @default 2
     */
    contextLines?: number;
    /**
     * Maximum depth to traverse
     * @default 20
     */
    maxDepth?: number;
}
/**
 * Create a search executor using regex pattern matching
 *
 * @example
 * ```typescript
 * const search = createSearchExecutor({
 *   maxResults: 50,
 *   contextLines: 3,
 * })
 *
 * const results = await search("function\\s+handleClick", "/path/to/project", context)
 * ```
 */
export declare function createSearchExecutor(options?: SearchExecutorOptions): SearchExecutor;
