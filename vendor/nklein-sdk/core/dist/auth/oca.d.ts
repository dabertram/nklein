import type { ITelemetryService } from "@nklein/shared";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface, OcaClientMetadata, OcaOAuthProviderOptions, OcaTokenResolution } from "./types";
export declare const DEFAULT_INTERNAL_IDCS_CLIENT_ID = "a8331954c0cf48ba99b5dd223a14c6ea";
export declare const DEFAULT_INTERNAL_IDCS_URL = "https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com";
export declare const DEFAULT_INTERNAL_IDCS_SCOPES = "openid offline_access";
export declare const DEFAULT_INTERNAL_OCA_BASE_URL = "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export declare const DEFAULT_EXTERNAL_IDCS_CLIENT_ID = "c1aba3deed5740659981a752714eba33";
export declare const DEFAULT_EXTERNAL_IDCS_URL = "https://login-ext.identity.oraclecloud.com";
export declare const DEFAULT_EXTERNAL_IDCS_SCOPES = "openid offline_access";
export declare const DEFAULT_EXTERNAL_OCA_BASE_URL = "https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export declare const OCI_HEADER_OPC_REQUEST_ID = "opc-request-id";
export declare function loginOcaOAuth(options: OcaOAuthProviderOptions & {
    callbacks: OAuthLoginCallbacks;
    telemetry?: ITelemetryService;
}): Promise<OAuthCredentials>;
export declare function refreshOcaToken(credentials: OAuthCredentials, options?: OcaOAuthProviderOptions): Promise<OAuthCredentials>;
export declare function getValidOcaCredentials(currentCredentials: OAuthCredentials | null, options?: OcaTokenResolution & {
    telemetry?: ITelemetryService;
}, providerOptions?: OcaOAuthProviderOptions & {
    telemetry?: ITelemetryService;
}): Promise<OAuthCredentials | null>;
export declare function createOcaOAuthProvider(options?: OcaOAuthProviderOptions): OAuthProviderInterface;
export declare function generateOcaOpcRequestId(taskId: string, token: string): Promise<string>;
export declare function createOcaRequestHeaders(input: {
    accessToken: string;
    taskId: string;
    metadata?: OcaClientMetadata;
}): Promise<Record<string, string>>;
