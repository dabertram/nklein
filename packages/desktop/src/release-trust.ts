import type { TrustedDesktopReleaseKeys } from "./update-manifest-signature.js";

/**
 * Public (never secret) Ed25519 release-manifest keys embedded in packaged clients.
 *
 * Stable/beta update checks fail closed while this is empty. Activating signed releases means adding the public half
 * here and placing only the private half in the protected release environment as NKLEIN_RELEASE_MANIFEST_PRIVATE_KEY.
 * Key ids make overlap-based rotation possible: ship a client trusting old+new before signing solely with the new key.
 */
export const TRUSTED_DESKTOP_RELEASE_KEYS: TrustedDesktopReleaseKeys = Object.freeze({});
