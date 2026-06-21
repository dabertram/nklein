import type { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import type { SessionMessagesArtifactUploader } from "../../types/session";
import { type CreateRootSessionInput } from "../models/session-row";
import { UnifiedSessionPersistenceService } from "./persistence-service";
export declare class CoreSessionService extends UnifiedSessionPersistenceService {
    private readonly store;
    constructor(store: SqliteSessionStore, options?: {
        sessionArtifactsDir?: string;
        messagesArtifactUploader?: SessionMessagesArtifactUploader;
    });
    createRootSession(input: CreateRootSessionInput): void;
}
export type { CreateRootSessionInput, CreateRootSessionWithArtifactsInput, RootSessionArtifacts, SessionRow, UpsertSubagentInput, } from "../models/session-row";
