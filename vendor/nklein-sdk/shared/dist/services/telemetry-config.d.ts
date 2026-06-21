import type { OpenTelemetryClientConfig, TelemetryMetadata } from "./telemetry";
export interface NKleinTelemetryServiceConfig extends OpenTelemetryClientConfig {
    metadata: TelemetryMetadata;
}
export declare function createNKleinTelemetryServiceMetadata(overrides?: Partial<TelemetryMetadata>): TelemetryMetadata;
export declare function createNKleinTelemetryServiceConfig(configOverrides?: Partial<NKleinTelemetryServiceConfig>): NKleinTelemetryServiceConfig;
