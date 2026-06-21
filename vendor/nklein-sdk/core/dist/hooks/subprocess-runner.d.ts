export interface RunSubprocessEventOptions {
    command: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    timeoutMs?: number;
    onSpawn?: (event: {
        command: string[];
        pid?: number;
        detached: boolean;
    }) => void;
}
export interface RunSubprocessEventResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    parsedJson?: unknown;
    parseError?: string;
    timedOut?: boolean;
}
export declare function runSubprocessEvent(payload: unknown, options: RunSubprocessEventOptions): Promise<RunSubprocessEventResult | undefined>;
