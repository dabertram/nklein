export declare function extractModelIdsFromPayload(payload: unknown, providerId: string): string[];
export declare function fetchModelIdsFromSource(url: string, providerId: string): Promise<string[]>;
export declare function resolveModelsSourceUrl(baseUrl: string | undefined, defaultBaseUrl: string | undefined, modelsSourceUrl: string | undefined): string | undefined;
