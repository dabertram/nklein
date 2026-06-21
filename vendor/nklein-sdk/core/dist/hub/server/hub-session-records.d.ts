import type { SessionRecord as HubSessionRecord, SessionParticipant } from "@nklein/shared";
import type { SessionRecord as LocalSessionRecord } from "../../types/sessions";
export type HubSessionState = {
    createdByClientId: string;
    interactive: boolean;
    participants: Map<string, SessionParticipant>;
};
export declare function toHubSessionRecord(session: LocalSessionRecord, state?: HubSessionState): HubSessionRecord;
