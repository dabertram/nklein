import type { HubCommandEnvelope, HubReplyEnvelope } from "@nklein/shared";
import type { HubScheduleService } from "./schedule-service";
export declare class HubScheduleCommandService {
    private readonly schedules;
    constructor(schedules: HubScheduleService);
    handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
    private toCreateInput;
    private toUpdateInput;
}
