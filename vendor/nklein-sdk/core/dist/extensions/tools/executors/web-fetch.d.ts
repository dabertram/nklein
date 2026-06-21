/**
 * Web Fetch Executor
 *
 * Built-in implementation for fetching web content using native fetch.
 */
import type { WebFetchExecutor } from "../types";
/**
 * Options for the web fetch executor
 */
export interface WebFetchExecutorOptions {
    /**
     * Timeout for fetch requests in milliseconds
     * @default 30000 (30 seconds)
     */
    timeoutMs?: number;
    /**
     * Maximum response size in bytes
     * @default 5_000_000 (5MB)
     */
    maxResponseBytes?: number;
    /**
     * User agent string
     * @default "Mozilla/5.0 (compatible; AgentBot/1.0)"
     */
    userAgent?: string;
    /**
     * Additional headers
     */
    headers?: Record<string, string>;
    /**
     * Whether to follow redirects
     * @default true
     */
    followRedirects?: boolean;
    /**
     * Maximum number of redirects to follow
     * @default 5
     */
    maxRedirects?: number;
}
/**
 * Create a web fetch executor using native fetch
 *
 * @example
 * ```typescript
 * const webFetch = createWebFetchExecutor({
 *   timeoutMs: 15000,
 *   maxResponseBytes: 2_000_000,
 * })
 *
 * const content = await webFetch(
 *   "https://docs.example.com/api",
 *   "Extract the authentication section",
 *   context
 * )
 * ```
 */
export declare function createWebFetchExecutor(options?: WebFetchExecutorOptions): WebFetchExecutor;
