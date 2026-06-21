import type { ITelemetryService } from "@nklein/shared";
import type { HubScheduleRuntimeHandlers, HubScheduleServiceOptions } from "../../cron/service/schedule-service";
export interface CreateLocalHubScheduleRuntimeHandlersOptions extends Pick<HubScheduleServiceOptions, "logger"> {
    /**
     * Custom `fetch` implementation forwarded to the scheduler's internal
     * `LocalRuntimeHost`. Used by the AI gateway providers for every
     * scheduled session executed inside this hub process.
     */
    fetch?: typeof fetch;
    telemetry?: ITelemetryService;
}
export declare function createLocalHubScheduleRuntimeHandlers(options?: CreateLocalHubScheduleRuntimeHandlersOptions): HubScheduleRuntimeHandlers;
