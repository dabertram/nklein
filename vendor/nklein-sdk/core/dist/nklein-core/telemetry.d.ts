import type { ITelemetryService } from "@nklein/shared";
import type { NKleinCoreStartInput } from "./types";
export interface EmitSessionStartedTelemetryInput {
    input: NKleinCoreStartInput;
    sessionId: string;
    telemetry?: ITelemetryService;
    clientName?: string;
    runtimeAddress?: string;
}
export declare function emitSessionStartedTelemetry(input: EmitSessionStartedTelemetryInput): void;
