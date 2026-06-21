import type { FileSessionService } from "../../../session/services/file-session-service";
import type { CoreSessionService } from "../../../session/services/session-service";
import type { ActiveSession } from "../../../types/session";
import type { SessionRecord } from "../../../types/sessions";
export type SessionBackend = CoreSessionService | FileSessionService;
export declare function toActiveSessionRecord(session: ActiveSession): SessionRecord;
