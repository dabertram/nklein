import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assessReleasePackaging, releaseChannel } = require("../scripts/release-policy.cjs") as {
	releaseChannel(value: string | undefined): "stable" | "beta" | "nightly" | "dev";
	assessReleasePackaging(
		platform: string,
		env: Record<string, string | undefined>,
	): { ok: boolean; channel: string; protected: boolean; missing?: string[]; reason?: string };
};

describe("desktop release packaging policy", () => {
	it("defaults ordinary local packaging to the credential-free dev channel", () => {
		expect(releaseChannel(undefined)).toBe("dev");
		expect(assessReleasePackaging("darwin", {})).toMatchObject({ ok: true, channel: "dev", protected: false });
	});

	it("requires signing plus notarization credentials for protected macOS channels", () => {
		expect(assessReleasePackaging("darwin", { NKLEIN_RELEASE_CHANNEL: "stable" })).toMatchObject({
			ok: false,
			missing: ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"],
		});
		expect(
			assessReleasePackaging("darwin", {
				NKLEIN_RELEASE_CHANNEL: "beta",
				CSC_LINK: "certificate",
				CSC_KEY_PASSWORD: "secret",
				APPLE_ID: "release@example.invalid",
				APPLE_ID_PASSWORD: "secret",
				APPLE_TEAM_ID: "TEAM",
			}),
		).toMatchObject({ ok: true, channel: "beta", protected: true });
	});

	it("requires Authenticode credentials for protected Windows channels", () => {
		expect(assessReleasePackaging("win32", { NKLEIN_RELEASE_CHANNEL: "stable" })).toMatchObject({
			ok: false,
			missing: ["CSC_LINK", "CSC_KEY_PASSWORD"],
		});
	});

	it("documents Linux as checksum plus signed-manifest, without pretending native signing exists", () => {
		expect(assessReleasePackaging("linux", { NKLEIN_RELEASE_CHANNEL: "stable" })).toMatchObject({
			ok: true,
			channel: "stable",
			protected: true,
		});
	});

	it("rejects invalid channels and unknown protected-build platforms", () => {
		expect(() => releaseChannel("preview")).toThrow(/Invalid NKLEIN_RELEASE_CHANNEL/u);
		expect(assessReleasePackaging("freebsd", { NKLEIN_RELEASE_CHANNEL: "stable" })).toMatchObject({ ok: false });
	});
});
