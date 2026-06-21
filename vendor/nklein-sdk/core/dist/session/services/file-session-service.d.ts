import type { SessionMessagesArtifactUploader } from "../../types/session";
import { UnifiedSessionPersistenceService } from "./persistence-service";
export declare class FileSessionService extends UnifiedSessionPersistenceService {
    constructor(sessionsDir?: string, options?: {
        messagesArtifactUploader?: SessionMessagesArtifactUploader;
    });
    ensureSessionsDir(): string;
}
