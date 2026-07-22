// Credential and channel policy used by electron-builder's beforePack hook.
// @ts-check
"use strict";

const PROTECTED_CHANNELS = new Set(["stable", "beta"]);

/** @param {string | undefined} value */
function releaseChannel(value) {
	const normalized = value?.trim().toLowerCase() || "dev";
	if (!["stable", "beta", "nightly", "dev"].includes(normalized)) {
		throw new Error(`Invalid NKLEIN_RELEASE_CHANNEL "${value}".`);
	}
	return normalized;
}

/** @param {string[]} names @param {Record<string, string | undefined>} env */
function missingEnvironment(names, env) {
	return names.filter((name) => !env[name]?.trim());
}

/**
 * Stable/beta packages fail closed before electron-builder starts. Linux has no native application-signing convention
 * in this release policy; its bytes are SHA-256 pinned by the Ed25519-signed cross-platform release manifest.
 * @param {string} platformName Electron platform name: darwin, win32, or linux.
 * @param {Record<string, string | undefined>} env
 */
function assessReleasePackaging(platformName, env) {
	const channel = releaseChannel(env.NKLEIN_RELEASE_CHANNEL);
	if (!PROTECTED_CHANNELS.has(channel)) {
		return { ok: true, channel, protected: false, required: [] };
	}
	let required = [];
	if (platformName === "darwin") {
		required = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"];
	} else if (platformName === "win32") {
		required = ["CSC_LINK", "CSC_KEY_PASSWORD"];
	} else if (platformName !== "linux") {
		return { ok: false, channel, protected: true, required: [], missing: [], reason: `unsupported platform ${platformName}` };
	}
	const missing = missingEnvironment(required, env);
	return missing.length === 0
		? { ok: true, channel, protected: true, required }
		: { ok: false, channel, protected: true, required, missing, reason: `missing ${missing.join(", ")}` };
}

/** @param {import("electron-builder").BeforePackContext} context */
async function beforePack(context) {
	const result = assessReleasePackaging(context.electronPlatformName, process.env);
	if (!result.ok) {
		throw new Error(
			`Refusing ${result.channel} ${context.electronPlatformName} package: ${result.reason}. ` +
				"Protected channels may never fall back to unsigned/unnotarized output.",
		);
	}
	console.log(
		result.protected
			? `Release preflight passed for ${result.channel}/${context.electronPlatformName}.`
			: `Release preflight: ${result.channel}/${context.electronPlatformName} permits credential-free packaging.`,
	);
}

module.exports = beforePack;
module.exports.assessReleasePackaging = assessReleasePackaging;
module.exports.missingEnvironment = missingEnvironment;
module.exports.releaseChannel = releaseChannel;
module.exports.PROTECTED_CHANNELS = PROTECTED_CHANNELS;
