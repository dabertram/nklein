import { describe, expect, it } from "vitest";
import { authSettingsEqual } from "../../../src/nklein-agent/nklein-provider-service";

// authSettingsEqual compares only the four credential-bearing fields with `?? null` normalization. The test
// exercises that contract directly; a cast keeps it focused on those four without coupling to the full upstream
// SdkProviderSettings["auth"] shape.
type Auth = Parameters<typeof authSettingsEqual>[0];
const auth = (fields: Record<string, unknown>): Auth => fields as unknown as Auth;

const FULL = { accessToken: "at", refreshToken: "rt", accountId: "acc", expiresAt: 1000 };

describe("authSettingsEqual", () => {
	it("two absent settings are equal (nothing to persist)", () => {
		expect(authSettingsEqual(undefined, undefined)).toBe(true);
		expect(authSettingsEqual(auth({}), undefined)).toBe(true);
	});

	it("identical credentials are equal", () => {
		expect(authSettingsEqual(auth(FULL), auth({ ...FULL }))).toBe(true);
	});

	it("absent vs fully-populated is NOT equal (a first sign-in must persist)", () => {
		expect(authSettingsEqual(undefined, auth(FULL))).toBe(false);
		expect(authSettingsEqual(auth(FULL), undefined)).toBe(false);
	});

	it("normalizes an absent field so 'field undefined' and 'field omitted' compare equal", () => {
		// accountId omitted on one side, explicitly undefined on the other → still equal (both normalize to null).
		expect(authSettingsEqual(auth({ accessToken: "at" }), auth({ accessToken: "at", accountId: undefined }))).toBe(
			true,
		);
	});

	it("a difference in ANY of the four fields breaks equality (so a refresh is detected)", () => {
		for (const field of ["accessToken", "refreshToken", "accountId", "expiresAt"] as const) {
			const changed = { ...FULL, [field]: field === "expiresAt" ? 2000 : "changed" };
			expect(authSettingsEqual(auth(FULL), auth(changed)), `changing ${field} must be detected`).toBe(false);
		}
	});
});
