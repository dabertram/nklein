import type { SessionManifest } from "../../session/models/session-manifest";
import type { SessionHistoryRecord, SessionRecord } from "../../types/sessions";
import type { SessionBackend } from "./host";
import type { RuntimeHost } from "./runtime-host";
export interface SessionHistoryListOptions {
    limit?: number;
    includeManifestFallback?: boolean;
    hydrate?: boolean;
}
export declare function manifestToSessionRecord(manifest: SessionManifest): SessionRecord;
export declare function hydrateSessionHistory(host: Pick<RuntimeHost, "readSessionMessages">, rows: SessionRecord[]): Promise<SessionHistoryRecord[]>;
export declare function listSessionHistory(host: Pick<RuntimeHost, "listSessions" | "readSessionMessages">, options?: SessionHistoryListOptions): Promise<SessionHistoryRecord[]>;
/**
 * Lists history directly from the persistence backend without constructing a
 * runtime host. This keeps read-only history commands from initializing runtime
 * services such as plugins, MCP, or hub transport.
 */
export declare function listSessionHistoryFromBackend(backend: Pick<SessionBackend, "listSessions">, options?: SessionHistoryListOptions): Promise<SessionHistoryRecord[]>;
