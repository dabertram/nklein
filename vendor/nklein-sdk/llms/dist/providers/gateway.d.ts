import type { AgentModel, AgentModelEvent, GatewayConfig, GatewayModelHandleOptions, GatewayModelSelection, GatewayProviderRegistration, GatewayStreamRequest } from "@nklein/shared";
import { GatewayRegistry } from "./registry";
export type * from "@nklein/shared";
export interface Gateway {
    registerProvider(registration: GatewayProviderRegistration): this;
    configureProvider(config: NonNullable<GatewayConfig["providerConfigs"]>[number]): this;
    listProviders(): ReturnType<GatewayRegistry["listProviders"]>;
    listModels(providerId?: string): ReturnType<GatewayRegistry["listModels"]>;
    createAgentModel(selection: GatewayModelSelection, options?: GatewayModelHandleOptions): AgentModel;
    stream(request: GatewayStreamRequest): Promise<AsyncIterable<AgentModelEvent>>;
}
export declare class DefaultGateway implements Gateway {
    private readonly registry;
    private readonly logger;
    constructor(config?: GatewayConfig);
    registerProvider(registration: GatewayProviderRegistration): this;
    configureProvider(config: NonNullable<GatewayConfig["providerConfigs"]>[number]): this;
    listProviders(): import("@nklein/shared").GatewayProviderManifest[];
    listModels(providerId?: string): import("@nklein/shared").GatewayModelDefinition[];
    createAgentModel(selection: GatewayModelSelection, options?: GatewayModelHandleOptions): AgentModel;
    stream(request: GatewayStreamRequest): Promise<AsyncIterable<AgentModelEvent>>;
}
export declare function createGateway(config?: GatewayConfig): DefaultGateway;
//# sourceMappingURL=gateway.d.ts.map