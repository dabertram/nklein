/**
 * OpenAI Codex (ChatGPT OAuth) flow
 *
 * NOTE: This module uses Node.js crypto and http for the OAuth callback.
 * It is only intended for CLI use, not browser environments.
 */
import type { ITelemetryService } from "@nklein/shared";
import type { OAuthCredentials, OAuthPrompt, OAuthProviderInterface } from "./types";
export declare const OPENAI_CODEX_OAUTH_CONFIG: {
    readonly authorizationEndpoint: "https://auth.openai.com/oauth/authorize";
    readonly tokenEndpoint: "https://auth.openai.com/oauth/token";
    readonly clientId: "app_EMoamEEZ73f0CkXaXp7hrann";
    readonly redirectUri: "http://localhost:1455/auth/callback";
    readonly scopes: "openid profile email offline_access";
    readonly callbackPort: 1455;
    readonly jwtClaimPath: "https://api.openai.com/auth";
    readonly refreshBufferMs: number;
    readonly retryableTokenGraceMs: number;
    readonly httpTimeoutMs: number;
};
export type RefreshTokenResolution = {
    forceRefresh?: boolean;
    refreshBufferMs?: number;
    retryableTokenGraceMs?: number;
};
export declare function loginOpenAICodex(options: {
    onAuth: (info: {
        url: string;
        instructions?: string;
    }) => void;
    onPrompt: (prompt: OAuthPrompt) => Promise<string>;
    onProgress?: (message: string) => void;
    onManualCodeInput?: () => Promise<string>;
    originator?: string;
    telemetry?: ITelemetryService;
}): Promise<OAuthCredentials>;
export declare function refreshOpenAICodexToken(refreshToken: string, fallback?: OAuthCredentials): Promise<OAuthCredentials>;
export declare function getValidOpenAICodexCredentials(currentCredentials: OAuthCredentials | null, options?: RefreshTokenResolution & {
    telemetry?: ITelemetryService;
}): Promise<OAuthCredentials | null>;
export declare function isOpenAICodexTokenExpired(credentials: OAuthCredentials, refreshBufferMs?: number): boolean;
export declare function normalizeOpenAICodexCredentials(credentials: OAuthCredentials): OAuthCredentials;
export declare const openaiCodexOAuthProvider: OAuthProviderInterface;
