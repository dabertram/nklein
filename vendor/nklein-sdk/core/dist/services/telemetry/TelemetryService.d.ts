import type { BasicLogger, ITelemetryService, TelemetryMetadata, TelemetryProperties } from "@nklein/shared";
import type { ITelemetryAdapter } from "./ITelemetryAdapter";
export interface TelemetryServiceOptions {
    adapters?: ITelemetryAdapter[];
    metadata?: Partial<TelemetryMetadata>;
    distinctId?: string;
    commonProperties?: TelemetryProperties;
    logger?: BasicLogger;
}
export declare class TelemetryService implements ITelemetryService {
    private adapters;
    private metadata;
    private distinctId?;
    private commonProperties;
    constructor(options?: TelemetryServiceOptions);
    addAdapter(adapter: ITelemetryAdapter): void;
    setDistinctId(distinctId?: string): void;
    setMetadata(metadata: Partial<TelemetryMetadata>): void;
    updateMetadata(metadata: Partial<TelemetryMetadata>): void;
    setCommonProperties(properties: TelemetryProperties): void;
    updateCommonProperties(properties: TelemetryProperties): void;
    isEnabled(): boolean;
    capture(input: {
        event: string;
        properties?: TelemetryProperties;
    }): void;
    captureRequired(event: string, properties?: TelemetryProperties): void;
    recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    recordGauge(name: string, value: number | null, attributes?: TelemetryProperties, description?: string, required?: boolean): void;
    flush(): Promise<void>;
    dispose(): Promise<void>;
    private buildAttributes;
}
