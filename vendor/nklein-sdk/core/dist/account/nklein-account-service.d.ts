import type { NKleinAccountBalance, NKleinAccountOrganization, NKleinAccountOrganizationBalance, NKleinAccountOrganizationUsageTransaction, NKleinAccountPaymentTransaction, NKleinAccountUsageTransaction, NKleinAccountUser, NKleinOrganization, FeaturebaseTokenResponse, UserRemoteConfigResponse } from "./types";
export interface NKleinAccountServiceOptions {
    apiBaseUrl: string;
    getAuthToken: () => Promise<string | undefined | null>;
    getCurrentUserId?: () => Promise<string | undefined | null> | string | undefined | null;
    getOrganizationMemberId?: (organizationId: string) => Promise<string | undefined | null> | string | undefined | null;
    getHeaders?: () => Promise<Record<string, string> | undefined> | Record<string, string> | undefined;
    requestTimeoutMs?: number;
    fetchImpl?: typeof fetch;
}
export declare class NKleinAccountService {
    private readonly apiBaseUrl;
    private readonly getAuthTokenFn;
    private readonly getCurrentUserIdFn;
    private readonly getOrganizationMemberIdFn;
    private readonly getHeadersFn;
    private readonly requestTimeoutMs;
    private readonly fetchImpl;
    constructor(options: NKleinAccountServiceOptions);
    fetchMe(): Promise<NKleinAccountUser>;
    fetchRemoteConfig(): Promise<UserRemoteConfigResponse | null>;
    fetchFeaturebaseToken(): Promise<FeaturebaseTokenResponse | undefined>;
    fetchBalance(userId?: string): Promise<NKleinAccountBalance>;
    fetchUsageTransactions(userId?: string): Promise<NKleinAccountUsageTransaction[]>;
    fetchPaymentTransactions(userId?: string): Promise<NKleinAccountPaymentTransaction[]>;
    fetchUserOrganizations(): Promise<NKleinAccountOrganization[]>;
    fetchOrganization(organizationId: string): Promise<NKleinOrganization>;
    fetchOrganizationBalance(organizationId: string): Promise<NKleinAccountOrganizationBalance>;
    fetchOrganizationUsageTransactions(input: {
        organizationId: string;
        memberId?: string;
    }): Promise<NKleinAccountOrganizationUsageTransaction[]>;
    switchAccount(organizationId?: string | null): Promise<void>;
    private resolveUserId;
    private resolveOrganizationMemberId;
    private request;
}
