import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import type { DesktopReleaseManifest, DesktopReleaseManifestSignature } from "./update-plan.js";

export type TrustedDesktopReleaseKeys = Readonly<Record<string, string>>;

export type DesktopManifestSignatureVerification =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: "missing_signature" | "unsupported_algorithm" | "unknown_key" | "invalid_signature";
	  };

function canonicalJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalJsonValue);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([key, entry]) => [key, canonicalJsonValue(entry)]),
		);
	}
	return value;
}

/** Stable bytes signed by release tooling and verified by every updater client. */
export function canonicalDesktopReleaseManifest(manifest: DesktopReleaseManifest): string {
	const { releaseSignature: _releaseSignature, ...unsignedManifest } = manifest;
	return JSON.stringify(canonicalJsonValue(unsignedManifest));
}

export function signDesktopReleaseManifest(
	manifest: DesktopReleaseManifest,
	input: { readonly keyId: string; readonly privateKeyPem: string },
): DesktopReleaseManifest {
	const keyId = input.keyId.trim();
	if (!keyId) {
		throw new Error("Desktop release signing key id is empty.");
	}
	const signature: DesktopReleaseManifestSignature = {
		algorithm: "ed25519",
		keyId,
		value: sign(null, Buffer.from(canonicalDesktopReleaseManifest(manifest)), createPrivateKey(input.privateKeyPem)).toString(
			"base64",
		),
	};
	return { ...manifest, releaseSignature: signature };
}

export function verifyDesktopReleaseManifestSignature(
	manifest: DesktopReleaseManifest,
	trustedKeys: TrustedDesktopReleaseKeys,
): DesktopManifestSignatureVerification {
	const signature = manifest.releaseSignature;
	if (!signature) {
		return { ok: false, reason: "missing_signature" };
	}
	if (signature.algorithm !== "ed25519") {
		return { ok: false, reason: "unsupported_algorithm" };
	}
	const publicKeyPem = trustedKeys[signature.keyId];
	if (!publicKeyPem) {
		return { ok: false, reason: "unknown_key" };
	}
	try {
		const valid = verify(
			null,
			Buffer.from(canonicalDesktopReleaseManifest(manifest)),
			createPublicKey(publicKeyPem),
			Buffer.from(signature.value, "base64"),
		);
		return valid ? { ok: true } : { ok: false, reason: "invalid_signature" };
	} catch {
		return { ok: false, reason: "invalid_signature" };
	}
}
