import { type HubEndpointOverrides } from "../discovery/defaults";
export declare function spawnDetachedHubServer(workspaceRoot: string, endpoint?: HubEndpointOverrides): void;
export declare function prewarmDetachedHubServer(workspaceRoot: string, endpoint?: HubEndpointOverrides): void;
export interface DetachedHubResolution {
    url: string;
    authToken: string;
}
export declare function ensureDetachedHubServer(workspaceRoot: string, endpointOverrides?: HubEndpointOverrides): Promise<DetachedHubResolution>;
