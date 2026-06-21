import type { AutomationEventEnvelope, BasicLogger, ExtensionContext, ITelemetryService } from "@nklein/shared";
import type { CronService } from "../cron/service/cron-service";
import type { HubScheduleRuntimeHandlers } from "../cron/service/schedule-service";
import type { RuntimeHost } from "../runtime/host/runtime-host";
import type { NKleinAutomationEventIngressResult, NKleinAutomationEventLog, NKleinAutomationListEventsOptions, NKleinAutomationListRunsOptions, NKleinAutomationListSpecsOptions, NKleinAutomationRun, NKleinAutomationSpec, NKleinCoreAutomationApi, NKleinCoreAutomationOptions } from "./types";
export declare function normalizeAutomationOptions(options: NKleinCoreAutomationOptions | boolean | undefined): NKleinCoreAutomationOptions | undefined;
export declare function normalizeAutomationCronScope(scope: NKleinCoreAutomationOptions["cronScope"]): "global" | "workspace" | undefined;
export declare class NKleinCoreAutomationController implements NKleinCoreAutomationApi {
    private readonly getService;
    constructor(getService: () => CronService);
    start(): Promise<void>;
    stop(): Promise<void>;
    reconcileNow(): Promise<void>;
    ingestEvent(event: AutomationEventEnvelope): NKleinAutomationEventIngressResult;
    listEvents(options?: NKleinAutomationListEventsOptions): NKleinAutomationEventLog[];
    getEvent(eventId: string): NKleinAutomationEventLog | undefined;
    listSpecs(options?: NKleinAutomationListSpecsOptions): NKleinAutomationSpec[];
    listRuns(options?: NKleinAutomationListRunsOptions): NKleinAutomationRun[];
}
export interface NKleinCoreAutomationRuntimeHandlersInput {
    host: RuntimeHost;
    getExtensionContext(): ExtensionContext | undefined;
}
export declare function createNKleinCoreAutomationRuntimeHandlers(input: NKleinCoreAutomationRuntimeHandlersInput): HubScheduleRuntimeHandlers;
export interface NKleinCoreAutomationExtensionContextInput {
    automationService?: CronService;
    automation: NKleinCoreAutomationApi;
    context?: ExtensionContext;
    clientName?: string;
    distinctId?: string;
    logger?: BasicLogger;
    telemetry?: ITelemetryService;
}
export declare function createNKleinCoreAutomationExtensionContext(input: NKleinCoreAutomationExtensionContextInput): ExtensionContext | undefined;
