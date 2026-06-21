export interface ImportPluginModuleOptions {
    useCache?: boolean;
}
export declare function importPluginModule(pluginPath: string, options?: ImportPluginModuleOptions): Promise<Record<string, unknown>>;
