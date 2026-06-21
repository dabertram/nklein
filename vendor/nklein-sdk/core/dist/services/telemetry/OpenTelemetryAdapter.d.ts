import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import type { MeterProvider } from "@opentelemetry/sdk-metrics";
import type { ITelemetryAdapter, TelemetryMetadata, TelemetryProperties } from "./ITelemetryAdapter";
export interface OpenTelemetryAdapterOptions {
    readonly metadata: TelemetryMetadata;
    readonly meterProvider?: MeterProvider | null;
    readonly loggerProvider?: LoggerProvider | null;
    readonly name?: string;
    readonly enabled?: boolean | (() => boolean);
    readonly distinctId?: string;
    readonly commonProperties?: TelemetryProperties;
}
export declare class OpenTelemetryAdapter implements ITelemetryAdapter {
    readonly name: string;
    private readonly metadata;
    private readonly meter;
    private readonly logger;
    private readonly enabled;
    private distinctId?;
    private commonProperties;
    private counters;
    private histograms;
    private gauges;
    private gaugeValues;
    private readonly meterProvider?;
    private readonly loggerProvider?;
    constructor(options: OpenTelemetryAdapterOptions);
    emit(event: string, properties?: TelemetryProperties): void;
    emitRequired(event: string, properties?: TelemetryProperties): void;
    recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    recordGauge(name: string, value: number | null, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    isEnabled(): boolean;
    setDistinctId(distinctId?: string): void;
    setCommonProperties(properties: TelemetryProperties): void;
    updateCommonProperties(properties: TelemetryProperties): void;
    flush(): Promise<void>;
    dispose(): Promise<void>;
    private emitLog;
    private buildAttributes;
    private snapshotGaugeSeries;
    private flattenProperties;
}
