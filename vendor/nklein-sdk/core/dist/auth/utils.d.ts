import type { OAuthCallbackPayload } from "./server";
import type { OAuthCredentials } from "./types";
export declare function getProofKey(): Promise<{
    verifier: string;
    challenge: string;
}>;
export declare function normalizeBaseUrl(value: string): string;
export declare function resolveUrl(baseUrl: string, path: string): string;
export type ParsedAuthorizationInput = {
    code?: string;
    state?: string;
    provider?: string;
};
export type ParseAuthorizationInputOptions = {
    includeProvider?: boolean;
    allowHashCodeState?: boolean;
};
export declare function parseAuthorizationInput(input: string, options?: ParseAuthorizationInputOptions): ParsedAuthorizationInput;
export declare function decodeJwtPayload(token?: string): Record<string, unknown> | null;
export declare function parseOAuthError(text: string): {
    code?: string;
    message?: string;
};
export declare function isCredentialLikelyExpired(credentials: Pick<OAuthCredentials, "expires">, refreshBufferMs: number): boolean;
export declare function resolveAuthorizationCodeInput(input: {
    waitForCallback: () => Promise<OAuthCallbackPayload | null>;
    cancelWait: () => void;
    onManualCodeInput?: () => Promise<string>;
    parseOptions?: ParseAuthorizationInputOptions;
}): Promise<ParsedAuthorizationInput & {
    error?: string;
}>;
