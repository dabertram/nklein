import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedNKleinOauthProviderId } from "../../../src/nklein-agent/sdk-provider-boundary";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * These are the two managed-OAuth flows — the only provider-service paths besides the custom-provider manager
 * that MUTATE the SDK provider registry. Prime directive #1 (`CLOUD_ENABLED = false`) makes every one of them
 * refuse in the shipped build, and the module's own header states the property that gives that teeth: the
 * local-only assert runs BEFORE any network or credential touch.
 *
 * That ordering claim was untested, and it is the whole of the guarantee. A gate that runs AFTER the login has
 * already happened does not prevent the egress — it only declines to record it, which is the difference between
 * "we never called out" and "we called out and threw the answer away". So the probes below assert on the SPIES,
 * not on the return value: what must be true is that nothing was invoked.
 */
const boundary = vi.hoisted(() => ({
	getSdkProviderSettings: vi.fn(),
	loginManagedOauthProvider: vi.fn(),
	saveSdkProviderSettings: vi.fn(),
	startNKleinDeviceAuth: vi.fn(),
	completeNKleinDeviceAuth: vi.fn(),
}));
const selection = vi.hoisted(() => ({ writeKanbanSelectedProviderId: vi.fn() }));

vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => boundary);
vi.mock("../../../src/nklein-agent/nklein-provider-selection-store", () => selection);
vi.mock("../../../src/nklein-agent/nklein-provider-oauth", () => ({
	createRuntimeOauthCallbacks: vi.fn(() => ({})),
}));

const { completeDeviceAuth, runOauthLogin, startDeviceAuth } = await import(
	"../../../src/nklein-agent/nklein-provider-auth-flows"
);

/** A non-managed id, so the REAL local-only policy admits it and the flow body actually runs. */
const LOCAL_ID = "lmstudio" as ManagedNKleinOauthProviderId;
const SECRET = "at-super-secret-access-token";

function noNetworkAndNoWrite(): void {
	expect(boundary.loginManagedOauthProvider).not.toHaveBeenCalled();
	expect(boundary.startNKleinDeviceAuth).not.toHaveBeenCalled();
	expect(boundary.completeNKleinDeviceAuth).not.toHaveBeenCalled();
	expect(boundary.saveSdkProviderSettings).not.toHaveBeenCalled();
	expect(selection.writeKanbanSelectedProviderId).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary.getSdkProviderSettings.mockReturnValue(null);
	boundary.loginManagedOauthProvider.mockResolvedValue({
		access: SECRET,
		refresh: "rt-refresh",
		accountId: "acct-1",
		expires: 1_900_000_000_000,
	});
});

describe("the local-only gate runs BEFORE anything else", () => {
	it("refuses an OAuth login without calling out or writing a credential", async () => {
		// THE probe. The assertion that matters is on the spies: a gate placed after the login would still return
		// ok:false while the egress had already happened.
		const result = await runOauthLogin({ providerId: "nklein" });

		expect(result.ok).toBe(false);
		noNetworkAndNoWrite();
	});

	it("refuses to START a device auth without calling out", async () => {
		await expect(startDeviceAuth()).rejects.toThrow();
		noNetworkAndNoWrite();
	});

	it("refuses to COMPLETE a device auth without calling out or writing a credential", async () => {
		const result = await completeDeviceAuth({ deviceCode: "dc", expiresInSeconds: 60, pollIntervalSeconds: 5 });

		expect(result.ok).toBe(false);
		noNetworkAndNoWrite();
	});

	it("does not let a LOOPBACK base url buy an exemption", async () => {
		// The tempting future widening, and the reason this is worth pinning: "it points at localhost, so it is
		// local" reads perfectly reasonable — but `nklein`, `oca` and `openai-codex` always reach cloud whatever
		// url is handed to them, so admitting them on a loopback url breaches prime directive #1 for exactly the
		// three providers the directive exists to stop.
		for (const baseUrl of ["http://localhost:1234", "http://127.0.0.1:8080", "http://[::1]:3000"]) {
			expect((await runOauthLogin({ providerId: "nklein", baseUrl })).ok, baseUrl).toBe(false);
		}
		for (const providerId of ["oca", "openai-codex"] as ManagedNKleinOauthProviderId[]) {
			expect((await runOauthLogin({ providerId, baseUrl: "http://localhost:1234" })).ok, providerId).toBe(false);
		}
		noNetworkAndNoWrite();
	});

	it("names the provider that was refused", async () => {
		const result = await runOauthLogin({ providerId: "nklein" });

		expect(result.provider).toBe("nklein");
		expect(result.error ?? "").not.toBe("");
	});

	it("REFUSES structurally where the caller can see it, and throws where it cannot", async () => {
		// The two flows returning an api-contract response report `ok:false`, because a throw would surface as an
		// unhandled 500 rather than a stated refusal. `startDeviceAuth` returns a device-code object with no field
		// able to carry a failure, so throwing is its only honest option — pinned so the shapes are not
		// "harmonised" into one that cannot say no.
		await expect(runOauthLogin({ providerId: "nklein" })).resolves.toMatchObject({ ok: false });
		await expect(startDeviceAuth()).rejects.toThrow();
	});
});

describe("runOauthLogin, past the gate", () => {
	it("writes the credential and selects the provider", async () => {
		const result = await runOauthLogin({ providerId: LOCAL_ID });

		expect(result.ok).toBe(true);
		expect(boundary.saveSdkProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({ tokenSource: "oauth", setLastUsed: true }),
		);
		expect(selection.writeKanbanSelectedProviderId).toHaveBeenCalledWith(LOCAL_ID);
	});

	it("does NOT return the access token to the caller", async () => {
		// A response body is one screenshot away from a log, and secrets belong in neither. The summary reports
		// only WHETHER a key is configured.
		const result = await runOauthLogin({ providerId: LOCAL_ID });

		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(JSON.stringify(result)).not.toContain("rt-refresh");
		// It reports PRESENCE as a boolean — the whole point of the summary shape.
		expect(result.settings?.oauthAccessTokenConfigured).toBe(true);
		expect(result.settings?.oauthRefreshTokenConfigured).toBe(true);
	});

	it("does not let an OAuth token masquerade as a configured API KEY", async () => {
		// Two different credentials with two different resolution paths. Reporting the token as an api key would
		// tell the UI a manually-entered key exists, and tell a caller it can fall back to one that is not there.
		const result = await runOauthLogin({ providerId: LOCAL_ID });

		expect(result.settings?.oauthAccessTokenConfigured).toBe(true);
		expect(result.settings?.apiKeyConfigured).toBe(false);
	});

	it("PRESERVES unrelated existing settings instead of overwriting the record", async () => {
		// Logging in replaces credentials, not the whole provider configuration; dropping the model would silently
		// reset a deliberate choice as a side effect of re-authenticating.
		boundary.getSdkProviderSettings.mockReturnValue({ provider: LOCAL_ID, model: "chosen-model" });
		await runOauthLogin({ providerId: LOCAL_ID });

		expect(boundary.saveSdkProviderSettings.mock.calls[0]?.[0].settings).toMatchObject({ model: "chosen-model" });
	});

	it("CLEARS a stale base url when the login supplies none", async () => {
		// The field is deleted, not left alone. A base url carried over from a previous host would keep routing
		// there while the UI showed a fresh login — the setting outliving the reason it was set.
		boundary.getSdkProviderSettings.mockReturnValue({ provider: LOCAL_ID, baseUrl: "http://old-host:9999" });
		await runOauthLogin({ providerId: LOCAL_ID });

		expect(boundary.saveSdkProviderSettings.mock.calls[0]?.[0].settings).not.toHaveProperty("baseUrl");
	});

	it("keeps a base url the login DID supply, trimmed", async () => {
		await runOauthLogin({ providerId: LOCAL_ID, baseUrl: "  http://host:1234  " });

		expect(boundary.saveSdkProviderSettings.mock.calls[0]?.[0].settings.baseUrl).toBe("http://host:1234");
	});

	it("treats a whitespace-only base url as none at all", async () => {
		boundary.getSdkProviderSettings.mockReturnValue({ provider: LOCAL_ID, baseUrl: "http://old-host:9999" });
		await runOauthLogin({ providerId: LOCAL_ID, baseUrl: "   " });

		expect(boundary.saveSdkProviderSettings.mock.calls[0]?.[0].settings).not.toHaveProperty("baseUrl");
	});

	it("normalises a SECONDS expiry to milliseconds", async () => {
		// OAuth servers return both; storing a seconds value as milliseconds dates the token to 1970 and makes
		// every request look expired.
		boundary.loginManagedOauthProvider.mockResolvedValue({ access: SECRET, refresh: "r", expires: 1_900_000_000 });
		await runOauthLogin({ providerId: LOCAL_ID });

		expect(boundary.saveSdkProviderSettings.mock.calls[0]?.[0].settings.auth.expiresAt).toBe(1_900_000_000_000);
	});

	it("reports a login failure as ok:false and writes NOTHING", async () => {
		// A half-applied login is worse than none: a saved token from a failed exchange would be used until it
		// visibly failed somewhere else.
		boundary.loginManagedOauthProvider.mockRejectedValue(new Error("provider said no"));
		const result = await runOauthLogin({ providerId: LOCAL_ID });

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/provider said no/);
		expect(boundary.saveSdkProviderSettings).not.toHaveBeenCalled();
		expect(selection.writeKanbanSelectedProviderId).not.toHaveBeenCalled();
	});

	it("does not select the provider when the credential write itself fails", async () => {
		// Selection means "use this one". Pointing at a provider whose credentials never landed sends every
		// subsequent call to a configuration that does not exist.
		boundary.saveSdkProviderSettings.mockImplementation(() => {
			throw new Error("disk full");
		});
		const result = await runOauthLogin({ providerId: LOCAL_ID });

		expect(result.ok).toBe(false);
		expect(selection.writeKanbanSelectedProviderId).not.toHaveBeenCalled();
	});
});
