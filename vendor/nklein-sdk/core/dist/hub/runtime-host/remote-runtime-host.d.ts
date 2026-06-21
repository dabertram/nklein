import { HubRuntimeHost, type HubRuntimeHostOptions } from "./hub-runtime-host";
export interface RemoteRuntimeHostOptions extends Omit<HubRuntimeHostOptions, "url"> {
    endpoint: string;
    workspaceRoot?: string;
    cwd?: string;
}
export declare class RemoteRuntimeHost extends HubRuntimeHost {
    constructor(options: RemoteRuntimeHostOptions);
}
