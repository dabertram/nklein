import { resolveNKleinDataDir, resolveNKleinDir } from "@nklein/shared/storage";
export interface HubServerDiscoveryRecord {
    hubId: string;
    protocolVersion: string;
    buildId?: string;
    authToken: string;
    host: string;
    port: number;
    url: string;
    pid?: number;
    startedAt: string;
    updatedAt: string;
}
export interface HubOwnerContext {
    ownerId: string;
    discoveryPath: string;
}
export declare function createHubAuthToken(): string;
export declare function resolveHubBuildId(): string;
export declare function resolveHubOwnerContext(ownerBasis?: string): HubOwnerContext;
export declare function createInMemoryHubOwnerContext(label?: string): HubOwnerContext;
export declare function readHubDiscovery(discoveryPath: string): Promise<HubServerDiscoveryRecord | undefined>;
export declare function writeHubDiscovery(discoveryPath: string, record: HubServerDiscoveryRecord): Promise<void>;
export declare function clearHubDiscovery(discoveryPath: string): Promise<void>;
export declare function withHubStartupLock<T>(discoveryPath: string, callback: () => Promise<T>): Promise<T>;
export declare function probeHubServer(url: string): Promise<HubServerDiscoveryRecord | undefined>;
export declare function createHubServerUrl(host: string, port: number, pathname?: string): string;
export declare function toHubHealthUrl(wsUrl: string): string;
export declare function isDiscoveryFilePresent(pathname: string): boolean;
export { resolveNKleinDataDir, resolveNKleinDir };
