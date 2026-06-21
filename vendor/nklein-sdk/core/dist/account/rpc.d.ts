import type { NKleinAccountActionRequest, ProviderActionRequest } from "@nklein/shared";
import type { NKleinAccountBalance, NKleinAccountOrganization, NKleinAccountOrganizationBalance, NKleinAccountOrganizationUsageTransaction, NKleinAccountPaymentTransaction, NKleinAccountUsageTransaction, NKleinAccountUser, FeaturebaseTokenResponse } from "./types";
export interface NKleinAccountOperations {
    fetchMe(): Promise<NKleinAccountUser>;
    fetchBalance(userId?: string): Promise<NKleinAccountBalance>;
    fetchUsageTransactions(userId?: string): Promise<NKleinAccountUsageTransaction[]>;
    fetchPaymentTransactions(userId?: string): Promise<NKleinAccountPaymentTransaction[]>;
    fetchUserOrganizations(): Promise<NKleinAccountOrganization[]>;
    fetchOrganizationBalance(organizationId: string): Promise<NKleinAccountOrganizationBalance>;
    fetchOrganizationUsageTransactions(input: {
        organizationId: string;
        memberId?: string;
    }): Promise<NKleinAccountOrganizationUsageTransaction[]>;
    switchAccount(organizationId?: string | null): Promise<void>;
    fetchFeaturebaseToken?(): Promise<FeaturebaseTokenResponse | undefined>;
}
export declare function isNKleinAccountActionRequest(request: ProviderActionRequest): request is NKleinAccountActionRequest;
export declare function executeNKleinAccountAction(request: NKleinAccountActionRequest, service: NKleinAccountOperations): Promise<unknown>;
export interface ProviderActionExecutor {
    runProviderAction(request: ProviderActionRequest): Promise<{
        result: unknown;
    }>;
}
export declare class RpcNKleinAccountService implements NKleinAccountOperations {
    private readonly executor;
    constructor(executor: ProviderActionExecutor);
    fetchMe(): Promise<NKleinAccountUser>;
    fetchBalance(userId?: string): Promise<NKleinAccountBalance>;
    fetchUsageTransactions(userId?: string): Promise<NKleinAccountUsageTransaction[]>;
    fetchPaymentTransactions(userId?: string): Promise<NKleinAccountPaymentTransaction[]>;
    fetchUserOrganizations(): Promise<NKleinAccountOrganization[]>;
    fetchOrganizationBalance(organizationId: string): Promise<NKleinAccountOrganizationBalance>;
    fetchOrganizationUsageTransactions(input: {
        organizationId: string;
        memberId?: string;
    }): Promise<NKleinAccountOrganizationUsageTransaction[]>;
    switchAccount(organizationId?: string | null): Promise<void>;
    fetchFeaturebaseToken(): Promise<FeaturebaseTokenResponse | undefined>;
    private request;
}
