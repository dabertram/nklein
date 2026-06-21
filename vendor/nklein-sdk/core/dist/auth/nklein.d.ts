import type { ITelemetryService } from "@nklein/shared";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types";
export type NKleinTokenResolution = {
    forceRefresh?: boolean;
    refreshBufferMs?: number;
    retryableTokenGraceMs?: number;
};
interface NKleinAuthApiUser {
    subject: string | null;
    email: string;
    name: string;
    nkleinUserId: string | null;
    accounts: string[] | null;
}
type HeaderMap = Record<string, string>;
type HeaderInput = HeaderMap | (() => Promise<HeaderMap> | HeaderMap);
export interface NKleinOAuthProviderOptions {
    apiBaseUrl: string;
    headers?: HeaderInput;
    requestTimeoutMs?: number;
    telemetry?: ITelemetryService;
    useWorkOSDeviceAuth?: boolean;
    callbackPath?: string;
    callbackPorts?: number[];
    /**
     * Optional identity provider name for token exchange.
     */
    provider?: string;
}
export interface NKleinOAuthCredentials extends OAuthCredentials {
    metadata?: {
        provider?: string;
        tokenType?: string;
        userInfo?: NKleinAuthApiUser;
        [key: string]: unknown;
    };
}
export declare function loginNKleinOAuth(options: NKleinOAuthProviderOptions & {
    callbacks: OAuthLoginCallbacks;
}): Promise<NKleinOAuthCredentials>;
export declare function startNKleinDeviceAuth(options?: {
    requestTimeoutMs?: number;
}): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresInSeconds: number;
    pollIntervalSeconds: number;
}>;
export declare function completeNKleinDeviceAuth(options: {
    deviceCode: string;
    expiresInSeconds: number;
    pollIntervalSeconds: number;
    apiBaseUrl: string;
    provider?: string;
    headers?: HeaderInput;
    requestTimeoutMs?: number;
    telemetry?: ITelemetryService;
}): Promise<NKleinOAuthCredentials>;
export declare function refreshNKleinToken(current: NKleinOAuthCredentials, options: NKleinOAuthProviderOptions): Promise<NKleinOAuthCredentials>;
export declare function getValidNKleinCredentials(currentCredentials: NKleinOAuthCredentials | null, providerOptions: NKleinOAuthProviderOptions, options?: NKleinTokenResolution): Promise<NKleinOAuthCredentials | null>;
export declare function createNKleinOAuthProvider(options: NKleinOAuthProviderOptions): OAuthProviderInterface;
export {};
