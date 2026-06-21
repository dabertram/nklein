import type { ITelemetryService } from "@nklein/shared";
import type { CoreSessionConfig } from "../types/config";
import { type TelemetryAgentIdentityProperties } from "./telemetry/core-events";
import type { enrichPromptWithMentions } from "./workspace";
/**
 * Emits local-only session creation telemetry (task.created/restarted and
 * hook discovery). The transport-agnostic `session.started` event is
 * emitted from `NKleinCore.start` so it fires for every backend (local,
 * hub, remote) at the outer API boundary.
 */
export declare function emitSessionCreationTelemetry(config: CoreSessionConfig, sessionId: string, isRestart: boolean, workspacePath: string, agentIdentity?: Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureHookDiscoveryTelemetry(telemetry: ITelemetryService | undefined, options: {
    workspacePath: string;
}): void;
export declare function emitMentionTelemetry(telemetry: ITelemetryService | undefined, enriched: Awaited<ReturnType<typeof enrichPromptWithMentions>>): void;
