import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	canonicalDesktopReleaseManifest,
	signDesktopReleaseManifest,
	verifyDesktopReleaseManifestSignature,
} from "../src/update-manifest-signature.js";
import type { DesktopReleaseManifest } from "../src/update-plan.js";

const manifest = (): DesktopReleaseManifest => ({
	version: "1.2.3",
	channel: "stable",
	assets: [
		{
			name: "nKlein-1.2.3-linux-x64.AppImage",
			url: "https://example.invalid/nKlein-1.2.3-linux-x64.AppImage",
			sha256: "a".repeat(64),
		},
	],
});

describe("desktop release manifest signatures", () => {
	it("signs and verifies canonical Ed25519 release metadata", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const signed = signDesktopReleaseManifest(manifest(), {
			keyId: "release-2026",
			privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		});

		expect(
			verifyDesktopReleaseManifestSignature(signed, {
				"release-2026": publicKey.export({ type: "spki", format: "pem" }).toString(),
			}),
		).toEqual({ ok: true });
	});

	it("rejects asset, checksum, and channel tampering", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const signed = signDesktopReleaseManifest(manifest(), {
			keyId: "release-2026",
			privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		});
		const trusted = { "release-2026": publicKey.export({ type: "spki", format: "pem" }).toString() };

		for (const tampered of [
			{ ...signed, channel: "beta" as const },
			{ ...signed, assets: [{ ...signed.assets[0]!, sha256: "b".repeat(64) }] },
			{ ...signed, assets: [{ ...signed.assets[0]!, url: "https://evil.invalid/app.AppImage" }] },
		]) {
			expect(verifyDesktopReleaseManifestSignature(tampered, trusted)).toEqual({
				ok: false,
				reason: "invalid_signature",
			});
		}
	});

	it("fails closed for absent/unknown keys and canonicalizes key order", () => {
		const { privateKey } = generateKeyPairSync("ed25519");
		const unsigned = manifest();
		const signed = signDesktopReleaseManifest(unsigned, {
			keyId: "unknown",
			privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		});

		expect(verifyDesktopReleaseManifestSignature(unsigned, {})).toEqual({ ok: false, reason: "missing_signature" });
		expect(verifyDesktopReleaseManifestSignature(signed, {})).toEqual({ ok: false, reason: "unknown_key" });
		expect(canonicalDesktopReleaseManifest({ assets: unsigned.assets, channel: "stable", version: "1.2.3" })).toBe(
			canonicalDesktopReleaseManifest(unsigned),
		);
	});
});
