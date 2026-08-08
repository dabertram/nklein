import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * The account/health cluster against the nklein.bot API. Three behaviours earn the tests, and each is a
 * DEFAULT — the value returned when the real answer could not be obtained.
 *
 * 1. `getNKleinKanbanAccess` FAILS OPEN. Every failure path returns `enabled: true`: no settings, no token, no
 *    remote config, a network error. This is the mirror image of the green-signal problem the rest of this
 *    codebase guards against, and here the permissive default is the correct one — a gate that could not run
 *    must not lock a user out of their own board, least of all in a local-only build where the account API is
 *    never reachable at all. Pinned per path, because a single "fails closed" regression is invisible until it
 *    reaches someone who then cannot work.
 *
 * 2. The profile dedupe cache EVICTS A REJECTED PROMISE. Caching a rejection would make one transient network
 *    failure permanent for the whole TTL, and every retry inside that window would fail without a request being
 *    made — a failure that looks like a persistent outage and is not one.
 *
 * 3. The cache key includes the ACCESS TOKEN. Keying on the URL alone would hand one account's profile to
 *    another after a switch, and both responses are well-formed, so nothing downstream could tell.
 */
const settings = vi.hoisted(() => ({ getSelectedProviderSettings: vi.fn() }));
const oauth = vi.hoisted(() => ({ refreshManagedOauthSettings: vi.fn() }));
const sdk = vi.hoisted(() => ({
	fetchSdkNKleinAccountProfile: vi.fn(),
	fetchSdkNKleinUserRemoteConfig: vi.fn(),
	fetchSdkOrgData: vi.fn(),
	fetchSdkFeaturebaseToken: vi.fn(),
	fetchSdkNKleinAccountBalance: vi.fn(),
	fetchSdkOrganizationBalance: vi.fn(),
	switchSdkNKleinAccount: vi.fn(),
}));

vi.mock("../../../src/nklein-agent/nklein-provider-selected-settings", () => ({
	getSelectedProviderSettings: settings.getSelectedProviderSettings,
	DEFAULT_NKLEIN_API_BASE_URL: "https://api.nklein.invalid",
	toProviderServiceErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock("../../../src/nklein-agent/nklein-provider-oauth", () => oauth);
vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => sdk);

const { createProviderAccountApi } = await import("../../../src/nklein-agent/nklein-provider-account-api");

const withToken = (accessToken = "tok-a", over: Record<string, unknown> = {}) => ({
	provider: "nklein",
	auth: { accessToken, accountId: "acct-stored" },
	...over,
});

beforeEach(() => {
	vi.resetAllMocks();
	settings.getSelectedProviderSettings.mockReturnValue(withToken());
	oauth.refreshManagedOauthSettings.mockResolvedValue(null);
	sdk.fetchSdkNKleinAccountProfile.mockResolvedValue({ id: "acct-1", email: "a@b.c", displayName: "A" });
});

describe("kanban access fails OPEN", () => {
	it("is enabled when no provider is configured at all", async () => {
		// The local-only default. There is no account to ask, and refusing the board on that basis would make the
		// product unusable exactly where it is meant to work.
		settings.getSelectedProviderSettings.mockReturnValue(null);

		expect(await createProviderAccountApi().getNKleinKanbanAccess()).toEqual({ enabled: true });
	});

	it("is enabled when the provider carries no access token", async () => {
		settings.getSelectedProviderSettings.mockReturnValue({ provider: "nklein", auth: {} });

		expect(await createProviderAccountApi().getNKleinKanbanAccess()).toEqual({ enabled: true });
		expect(sdk.fetchSdkNKleinUserRemoteConfig).not.toHaveBeenCalled();
	});

	it("is enabled when the remote config is absent or names no organization", async () => {
		for (const remoteConfig of [null, { enabled: false }, { enabled: true, organizationId: null }]) {
			sdk.fetchSdkNKleinUserRemoteConfig.mockResolvedValue(remoteConfig);
			expect((await createProviderAccountApi().getNKleinKanbanAccess()).enabled, JSON.stringify(remoteConfig)).toBe(
				true,
			);
		}
	});

	it("is enabled — and REPORTS the error — when the lookup throws", async () => {
		// Both halves matter. Failing open keeps the user working; carrying the error keeps the failure visible
		// rather than presenting a network outage as a deliberate policy answer.
		sdk.fetchSdkNKleinUserRemoteConfig.mockRejectedValue(new Error("network down"));

		const access = await createProviderAccountApi().getNKleinKanbanAccess();
		expect(access.enabled).toBe(true);
		expect(access.error).toMatch(/network down/);
	});

	it("gates the board ONLY for an enterprise account whose config withholds it", async () => {
		// The single path to a `false`, and the reason the fail-open tests above are not vacuous: without one real
		// negative they could all be satisfied by a function returning `{enabled:true}` unconditionally.
		sdk.fetchSdkNKleinUserRemoteConfig.mockResolvedValue({
			enabled: true,
			organizationId: "org-1",
			value: JSON.stringify({ kanbanEnabled: false }),
		});
		sdk.fetchSdkOrgData.mockResolvedValue({ externalOrganizationId: "ext-1" });

		expect((await createProviderAccountApi().getNKleinKanbanAccess()).enabled).toBe(false);
	});

	it("leaves a NON-enterprise account enabled whatever the config says", async () => {
		// Enterprise membership is what makes the config binding at all; applying it to everyone would gate
		// ordinary accounts on a setting that was never meant for them.
		sdk.fetchSdkNKleinUserRemoteConfig.mockResolvedValue({
			enabled: true,
			organizationId: "org-1",
			value: JSON.stringify({ kanbanEnabled: false }),
		});
		sdk.fetchSdkOrgData.mockResolvedValue({ externalOrganizationId: null });

		expect((await createProviderAccountApi().getNKleinKanbanAccess()).enabled).toBe(true);
	});

	it("re-enables an enterprise account whose config explicitly permits the board", async () => {
		sdk.fetchSdkNKleinUserRemoteConfig.mockResolvedValue({
			enabled: true,
			organizationId: "org-1",
			value: JSON.stringify({ kanbanEnabled: true }),
		});
		sdk.fetchSdkOrgData.mockResolvedValue({ externalOrganizationId: "ext-1" });

		expect((await createProviderAccountApi().getNKleinKanbanAccess()).enabled).toBe(true);
	});
});

describe("the account profile", () => {
	it("is null for a non-nklein provider, without calling the account API", async () => {
		// Every local provider lands here. Asking nklein.bot about an LM Studio session would be both meaningless
		// and an egress a local-only build must not make.
		settings.getSelectedProviderSettings.mockReturnValue({ provider: "lmstudio", auth: { accessToken: "x" } });

		expect(await createProviderAccountApi().getNKleinAccountProfile()).toEqual({ profile: null });
		expect(sdk.fetchSdkNKleinAccountProfile).not.toHaveBeenCalled();
	});

	it("is null when nothing is configured", async () => {
		settings.getSelectedProviderSettings.mockReturnValue(null);

		expect(await createProviderAccountApi().getNKleinAccountProfile()).toEqual({ profile: null });
	});

	it("returns the fetched identity", async () => {
		expect(await createProviderAccountApi().getNKleinAccountProfile()).toEqual({
			profile: { accountId: "acct-1", email: "a@b.c", displayName: "A" },
		});
	});

	it("falls back to the STORED account id when the response omits one", async () => {
		// Losing the id would make the account look unidentified while it is perfectly well authenticated.
		sdk.fetchSdkNKleinAccountProfile.mockResolvedValue({ id: "  ", email: "a@b.c" });

		expect((await createProviderAccountApi().getNKleinAccountProfile()).profile?.accountId).toBe("acct-stored");
	});

	it("retries ONCE after an OAuth refresh, and no more", async () => {
		// An expired token is the common case and one refresh fixes it. Retrying without bound would hammer the
		// API on a credential that is simply wrong.
		sdk.fetchSdkNKleinAccountProfile.mockRejectedValueOnce(new Error("401")).mockResolvedValue({ id: "acct-2" });
		oauth.refreshManagedOauthSettings.mockResolvedValue({ settings: withToken("tok-refreshed"), apiKey: null });

		const result = await createProviderAccountApi().getNKleinAccountProfile();
		expect(result.profile?.accountId).toBe("acct-2");
		expect(sdk.fetchSdkNKleinAccountProfile).toHaveBeenCalledTimes(2);
	});

	it("gives up with a null profile when the refresh yields nothing", async () => {
		sdk.fetchSdkNKleinAccountProfile.mockRejectedValue(new Error("401"));
		oauth.refreshManagedOauthSettings.mockResolvedValue(null);

		expect(await createProviderAccountApi().getNKleinAccountProfile()).toEqual({ profile: null });
	});
});

describe("the profile dedupe cache", () => {
	it("shares ONE round trip between concurrent callers", async () => {
		// Opening the account dialog fetches balance and organizations together; without the dedupe that is two
		// identical requests for the same 5-second window.
		const api = createProviderAccountApi();
		await Promise.all([api.getNKleinAccountProfile(), api.getNKleinAccountProfile()]);

		expect(sdk.fetchSdkNKleinAccountProfile).toHaveBeenCalledTimes(1);
	});

	it("EVICTS a rejected promise so the next caller really retries", async () => {
		// The probe. A cached rejection turns one transient failure into a guaranteed failure for the rest of the
		// TTL, with no request made — indistinguishable from a persistent outage, and not one.
		const api = createProviderAccountApi();
		sdk.fetchSdkNKleinAccountProfile.mockRejectedValueOnce(new Error("transient"));
		oauth.refreshManagedOauthSettings.mockResolvedValue(null);
		await api.getNKleinAccountProfile();

		sdk.fetchSdkNKleinAccountProfile.mockResolvedValue({ id: "acct-recovered" });
		expect((await api.getNKleinAccountProfile()).profile?.accountId).toBe("acct-recovered");
	});

	it("keys on the ACCESS TOKEN, so a different account never reads the first one's profile", async () => {
		// Both responses are well-formed, so a URL-only key would hand one user's identity to another after a
		// switch and nothing downstream could tell.
		const api = createProviderAccountApi();
		await api.getNKleinAccountProfile();

		settings.getSelectedProviderSettings.mockReturnValue(withToken("tok-b"));
		sdk.fetchSdkNKleinAccountProfile.mockResolvedValue({ id: "acct-other" });

		expect((await api.getNKleinAccountProfile()).profile?.accountId).toBe("acct-other");
		expect(sdk.fetchSdkNKleinAccountProfile).toHaveBeenCalledTimes(2);
	});

	it("keys on the BASE URL as well, so a self-hosted endpoint is a distinct account", async () => {
		const api = createProviderAccountApi();
		await api.getNKleinAccountProfile();

		settings.getSelectedProviderSettings.mockReturnValue(withToken("tok-a", { baseUrl: "https://self.hosted" }));
		sdk.fetchSdkNKleinAccountProfile.mockResolvedValue({ id: "acct-selfhosted" });

		expect((await api.getNKleinAccountProfile()).profile?.accountId).toBe("acct-selfhosted");
		expect(sdk.fetchSdkNKleinAccountProfile).toHaveBeenCalledTimes(2);
	});

	it("does not share a cache between two API instances", async () => {
		// The cache is per instance by construction; a module-level one would outlive a provider switch.
		await createProviderAccountApi().getNKleinAccountProfile();
		await createProviderAccountApi().getNKleinAccountProfile();

		expect(sdk.fetchSdkNKleinAccountProfile).toHaveBeenCalledTimes(2);
	});
});

describe("the Featurebase token", () => {
	it("refuses, by name, when no provider is configured", async () => {
		settings.getSelectedProviderSettings.mockReturnValue(null);

		await expect(createProviderAccountApi().getFeaturebaseToken()).rejects.toThrow(/No provider settings configured/);
	});

	it("refuses a non-nklein provider by name", async () => {
		settings.getSelectedProviderSettings.mockReturnValue({ provider: "lmstudio", auth: { accessToken: "x" } });

		await expect(createProviderAccountApi().getFeaturebaseToken()).rejects.toThrow(/requires a !Klein provider/);
	});

	it("reports the GENERIC failure for a missing token — the specific reason never escapes", async () => {
		// Recorded as observed, not as I first assumed. The "No access token configured" error is thrown inside
		// the attempt, and the retry-after-refresh wrapper swallows it before trying again; with no refresh
		// available the caller sees only "Failed to fetch Featurebase token."
		//
		// Not a defect — the retry is deliberate and one bounded retry is right — but the specific diagnostic is
		// unreachable from outside, so a reader chasing "why can I not open feedback" gets the generic message.
		// Pinned as the true behaviour so nobody asserts the inner one and believes it reaches a user.
		settings.getSelectedProviderSettings.mockReturnValue({ provider: "nklein", auth: {} });
		oauth.refreshManagedOauthSettings.mockResolvedValue(null);

		await expect(createProviderAccountApi().getFeaturebaseToken()).rejects.toThrow(
			/Failed to fetch Featurebase token/,
		);
		expect(sdk.fetchSdkFeaturebaseToken).not.toHaveBeenCalled();
	});

	it("retries once after a refresh and returns the token", async () => {
		settings.getSelectedProviderSettings.mockReturnValue({ provider: "nklein", auth: {} });
		oauth.refreshManagedOauthSettings.mockResolvedValue({ settings: withToken("tok-refreshed"), apiKey: null });
		sdk.fetchSdkFeaturebaseToken.mockResolvedValue({ featurebaseJwt: "jwt-1" });

		await expect(createProviderAccountApi().getFeaturebaseToken()).resolves.toEqual({ featurebaseJwt: "jwt-1" });
		expect(sdk.fetchSdkFeaturebaseToken).toHaveBeenCalledTimes(1);
	});
});
