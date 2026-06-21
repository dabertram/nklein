import type { BasicLogger, ITelemetryService, OpenTelemetryClientConfig, TelemetryMetadata } from "@nklein/shared";
import { type Tracer } from "@opentelemetry/api";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OpenTelemetryAdapter, type OpenTelemetryAdapterOptions } from "./OpenTelemetryAdapter";
type OpenTelemetryExporterKind = "console" | "otlp";
export interface OpenTelemetryProviderOptions extends Omit<OpenTelemetryClientConfig, "enabled" | "logsExporter" | "metricsExporter" | "tracesExporter"> {
    serviceName?: string;
    serviceVersion?: string;
    enabled?: boolean;
    logsExporter?: string | OpenTelemetryExporterKind[];
    metricsExporter?: string | OpenTelemetryExporterKind[];
    tracesExporter?: string | OpenTelemetryExporterKind[];
    metricExportIntervalMs?: number;
    logMaxQueueSize?: number;
    logBatchSize?: number;
    logBatchTimeoutMs?: number;
}
export interface CreateOpenTelemetryTelemetryServiceOptions extends OpenTelemetryProviderOptions, Pick<OpenTelemetryAdapterOptions, "name" | "distinctId" | "commonProperties"> {
    metadata: TelemetryMetadata;
    logger?: BasicLogger;
}
export declare class OpenTelemetryProvider {
    readonly meterProvider: MeterProvider | null;
    readonly loggerProvider: LoggerProvider | null;
    readonly tracerProvider: NodeTracerProvider | null;
    private readonly options;
    constructor(options?: OpenTelemetryProviderOptions);
    /**
     * Returns a tracer for manual spans. Requires {@link OpenTelemetryProviderOptions.tracesExporter}
     * so that a {@link NodeTracerProvider} is registered.
     */
    getTracer(name?: string, version?: string): Tracer;
    createAdapter(options: Omit<OpenTelemetryAdapterOptions, "meterProvider" | "loggerProvider">): OpenTelemetryAdapter;
    createTelemetryService(options: Omit<CreateOpenTelemetryTelemetryServiceOptions, keyof OpenTelemetryProviderOptions>): ITelemetryService;
    forceFlush(): Promise<void>;
    dispose(): Promise<void>;
    private createMeterProvider;
    private createTracerProvider;
    private createLoggerProvider;
}
export declare function createOpenTelemetryTelemetryService(options: CreateOpenTelemetryTelemetryServiceOptions): {
    provider: OpenTelemetryProvider;
    telemetry: ITelemetryService;
};
export declare function createConfiguredTelemetryService(options: CreateOpenTelemetryTelemetryServiceOptions): {
    provider?: OpenTelemetryProvider;
    telemetry: ITelemetryService;
};
/**
 * Telemetry service plus the lifecycle closures (`flush`, `dispose`) every
 * host needs to drive the underlying provider during shutdown. Returned by
 * {@link createConfiguredTelemetryHandle} so detached daemons, the VS Code
 * extension, and the CLI can share one canonical implementation of the
 * "best-effort flush; settle dispose" semantics instead of each
 * re-implementing the same closures.
 */
export interface ConfiguredTelemetryHandle {
    readonly telemetry: ITelemetryService;
    /**
     * The underlying OpenTelemetry provider, when telemetry is enabled.
     * `undefined` when telemetry is disabled or opted out so callers can
     * detect the inactive case without inspecting `enabled` themselves.
     */
    readonly provider?: OpenTelemetryProvider;
    /**
     * Best-effort flush of any pending telemetry batches. Errors are
     * swallowed so callers can `await` this in shutdown paths without
     * blocking deactivation on a misbehaving exporter.
     */
    flush: () => Promise<void>;
    /** Disposes the telemetry service and its provider concurrently. */
    dispose: () => Promise<void>;
}
/**
 * Builds a {@link ConfiguredTelemetryHandle} so hosts (CLI, VS Code, hub
 * daemon) share one canonical flush/dispose implementation. Without a
 * shared helper each host re-derived the same closures and they tended
 * to drift; this factory keeps the lifecycle uniform across hosts.
 */
export declare function createConfiguredTelemetryHandle(options: CreateOpenTelemetryTelemetryServiceOptions): ConfiguredTelemetryHandle;
export {};
