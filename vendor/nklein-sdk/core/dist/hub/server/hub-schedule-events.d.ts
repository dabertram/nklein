import type { HubCommandEnvelope, HubEventEnvelope } from "@nklein/shared";
export declare function eventNameForScheduleCommand(command: HubCommandEnvelope["command"]): HubEventEnvelope["event"] | undefined;
