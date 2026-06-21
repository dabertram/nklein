import type * as LlmsProviders from "@nklein/llms";
import { SessionArtifacts } from "../../services/session-artifacts";
import type { SessionMessagesArtifactUploader, SessionPersistenceAdapter } from "../../types/session";
import { type SessionManifest } from "../models/session-manifest";
export declare class SessionManifestStore {
    private readonly adapter;
    private readonly messagesArtifactUploader?;
    readonly artifacts: SessionArtifacts;
    constructor(adapter: SessionPersistenceAdapter, messagesArtifactUploader?: SessionMessagesArtifactUploader | undefined);
    ensureSessionsDir(): string;
    initializeMessagesFile(sessionId: string, path: string, startedAt: string): void;
    writeSessionManifest(manifestPath: string, manifest: SessionManifest): void;
    readSessionManifest(sessionId: string): SessionManifest | undefined;
    readManifestFile(sessionId: string): {
        path: string;
        manifest?: SessionManifest;
    };
    resolveArtifactPath(sessionId: string, kind: "messagesPath", fallback: (id: string) => string): Promise<string>;
    persistSessionMessages(sessionId: string, messages: LlmsProviders.Message[], systemPrompt?: string): Promise<void>;
    appendStaleSessionHookLog(detectedAt: string, sessionId: string, pid: number, reason: string, source: string): void;
}
