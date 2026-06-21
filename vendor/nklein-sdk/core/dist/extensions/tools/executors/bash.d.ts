/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */
import type { BashExecutor } from "../types";
/**
 * Options for the bash executor
 */
export interface BashExecutorOptions {
    /**
     * Shell to use for execution
     * @default "/bin/bash" on Unix, "powershell" on Windows
     */
    shell?: string;
    /**
     * Timeout for command execution in milliseconds
     * @default 30000 (30 seconds)
     */
    timeoutMs?: number;
    /**
     * Maximum output size in bytes
     * @default 1_000_000 (1MB)
     */
    maxOutputBytes?: number;
    /**
     * Environment variables to add/override
     */
    env?: Record<string, string>;
    /**
     * Whether to combine stdout and stderr
     * @default true
     */
    combineOutput?: boolean;
}
/**
 * Create a bash executor using Node.js spawn
 *
 * @example
 * ```typescript
 * const bash = createBashExecutor({
 *   timeoutMs: 60000, // 1 minute timeout
 *   shell: "/bin/zsh",
 * })
 *
 * const output = await bash("ls -la", "/path/to/project", context)
 * ```
 */
export declare function createBashExecutor(options?: BashExecutorOptions): BashExecutor;
