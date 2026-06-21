import type { BasicLogger } from "@nklein/shared";
import type { ITelemetryAdapter, TelemetryProperties } from "./ITelemetryAdapter";
/**
 * {@link ITelemetryAdapter} implementation that forwards telemetry to a {@link BasicLogger}.
 *
 * This is intentionally named *Sink* (not "adapter") to distinguish it from host logging bridges
 * such as the CLI Pino bundle: it consumes telemetry events and writes them to the injected logger.
 */
export interface TelemetryLoggerSinkOptions {
    logger?: BasicLogger;
    name?: string;
    enabled?: boolean | (() => boolean);
}
export declare class TelemetryLoggerSink implements ITelemetryAdapter {
    readonly name: string;
    private readonly logger?;
    private readonly enabled;
    constructor(options?: TelemetryLoggerSinkOptions);
    emit(event: string, properties?: TelemetryProperties): void;
    emitRequired(event: string, properties?: TelemetryProperties): void;
    recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    recordGauge(name: string, value: number | null, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    isEnabled(): boolean;
    flush(): Promise<void>;
    dispose(): Promise<void>;
}
