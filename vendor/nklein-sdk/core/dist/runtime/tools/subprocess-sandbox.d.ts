export interface SubprocessSandboxOptions {
    /** Inline script to execute via `node -e`. Mutually exclusive with {@link bootstrapFile}. */
    bootstrapScript?: string;
    /** Path to a JavaScript file to execute via `node <file>`. Mutually exclusive with {@link bootstrapScript}. */
    bootstrapFile?: string;
    /** Runtime executable for internal JavaScript helpers. Defaults to node/bun instead of packaged CLI binaries. */
    runtimeExecutable?: string;
    name?: string;
    onEvent?: (event: {
        name: string;
        payload?: unknown;
    }) => void;
}
export interface SandboxCallOptions {
    timeoutMs?: number;
}
export declare const NKLEIN_JS_RUNTIME_PATH_ENV = "NKLEIN_JS_RUNTIME_PATH";
export declare function resolveSubprocessRuntimeExecutable(options?: {
    env?: NodeJS.ProcessEnv;
    execPath?: string;
    runtimeExecutable?: string;
}): string;
export declare function buildSubprocessSandboxCommand(args: string[], options?: {
    env?: NodeJS.ProcessEnv;
    execArgv?: string[];
    name?: string;
    execPath?: string;
    runtimeExecutable?: string;
}): string[];
export declare class SubprocessSandbox {
    private readonly options;
    private process;
    private requestCounter;
    private readonly pending;
    constructor(options: SubprocessSandboxOptions);
    private get processLabel();
    private clearPendingRequest;
    start(): void;
    call<TResult = unknown>(method: string, args: unknown, options?: SandboxCallOptions): Promise<TResult>;
    shutdown(): Promise<void>;
    private onMessage;
    private failPending;
}
