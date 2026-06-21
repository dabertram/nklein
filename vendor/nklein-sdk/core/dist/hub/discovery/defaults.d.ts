export declare const DEFAULT_HUB_HOST = "127.0.0.1";
export declare const DEFAULT_HUB_PORT = 25463;
export declare const DEFAULT_HUB_PATHNAME = "/hub";
export interface HubEndpointOverrides {
    host?: string;
    port?: number;
    pathname?: string;
}
export interface ResolveHubDefaultsOptions {
    env?: NodeJS.ProcessEnv;
    execArgv?: string[];
}
export declare function resolveDefaultHubHost(options?: ResolveHubDefaultsOptions): string;
export declare function resolveDefaultHubPort(options?: ResolveHubDefaultsOptions): number;
export declare function resolveDefaultHubPathname(options?: ResolveHubDefaultsOptions): string;
export declare function resolveHubEndpointOptions(overrides?: HubEndpointOverrides, options?: ResolveHubDefaultsOptions): Required<HubEndpointOverrides>;
