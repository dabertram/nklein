import type { HubCommandEnvelope, HubEventEnvelope, HubReplyEnvelope } from "@nklein/shared";
import { CronService } from "../../cron/service/cron-service";
import type { HubWebSocketServerOptions } from "./hub-server-options";
import type { NativeHubTransport } from "./native-transport";
/** @internal Exported for unit testing fetch/runtime wiring. */
export declare class HubServerTransport implements NativeHubTransport {
    readonly options: HubWebSocketServerOptions;
    private readonly clients;
    private readonly listeners;
    private readonly sessionState;
    private readonly pendingApprovals;
    private readonly pendingCapabilityRequests;
    private readonly suppressNextTerminalEventBySession;
    private readonly schedules;
    private readonly scheduleCommands;
    private readonly settings;
    private readonly cronService?;
    private readonly sessionHost;
    private readonly hubId;
    private readonly ctx;
    constructor(options: HubWebSocketServerOptions);
    getCronService(): CronService | undefined;
    getHubId(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
    private handleSettingsList;
    private handleSettingsToggle;
    subscribe(clientId: string, listener: (event: HubEventEnvelope) => void, options?: {
        sessionId?: string;
    }): () => void;
    private detachClientFromSessions;
    private publish;
}
