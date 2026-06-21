export declare const NKLEIN_BUILD_ENV_ENV = "NKLEIN_BUILD_ENV";
export declare const NKLEIN_DEBUG_HOST_ENV = "NKLEIN_DEBUG_HOST";
export declare const NKLEIN_DEBUG_PORT_BASE_ENV = "NKLEIN_DEBUG_PORT_BASE";
export type NKleinBuildEnv = "development" | "production";
export type NKleinDebugRole = "rpc" | "hook" | "plugin-sandbox" | "connector" | "sandbox";
export interface ResolveNKleinBuildEnvOptions {
    env?: NodeJS.ProcessEnv;
    execArgv?: string[];
    debugRole?: NKleinDebugRole;
}
export declare function resolveNKleinBuildEnv(options?: ResolveNKleinBuildEnvOptions): NKleinBuildEnv;
export declare function withResolvedNKleinBuildEnv(env?: NodeJS.ProcessEnv, options?: Omit<ResolveNKleinBuildEnvOptions, "env">): NodeJS.ProcessEnv;
export declare function augmentNodeCommandForDebug(command: string[], options?: ResolveNKleinBuildEnvOptions): string[];
