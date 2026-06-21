export type ProviderOptionsPatch = Record<string, Record<string, unknown>>;
export declare function toProviderOptionsKey(providerId: string): string;
export declare function createEphemeralCacheControl(): {
    cache_control: {
        type: "ephemeral";
    };
};
//# sourceMappingURL=utils.d.ts.map