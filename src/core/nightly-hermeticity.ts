/**
 * N4 nightly hermeticity contract.
 *
 * The nightly runner starts a real runtime, so a fake model response alone is not enough: the runtime can still
 * observe the host fleet, power mode, clock/timer windows, filesystem mtimes, update feeds, network, and port
 * discovery. This module gives the child and parent one typed, fail-closed receipt for the exact posture in use.
 */

export const NIGHTLY_HERMETIC_ENV = "NKLEIN_NIGHTLY_HERMETIC";
export const NIGHTLY_HERMETIC_EPOCH_MS = 1_700_000_000_000;

export function isNightlyHermeticEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
	return env[NIGHTLY_HERMETIC_ENV] === "1";
}

export interface NightlyHermeticEvidence {
	readonly schemaVersion: 1;
	readonly modelGateway: "aimock_loopback";
	readonly loadedModels: "fake_lms_cli";
	readonly gitRemotes: "sandbox_network_none";
	readonly updateFeeds: "disabled";
	readonly webEgress: "sandbox_network_none";
	readonly triggerClock: "fixed_epoch";
	readonly triggerFileWatches: "disabled";
	readonly triggerTicks: "disabled_periodic";
	readonly reviewDedupTimer: "disabled";
	readonly watchdogTicks: "disabled_periodic";
	readonly powerMode: "fixed_unknown";
	readonly filesystemMtimes: "fixed_logical";
	readonly runtimePort: "kernel_ephemeral_no_probe";
}

export const NIGHTLY_HERMETIC_EVIDENCE: NightlyHermeticEvidence = {
	schemaVersion: 1,
	modelGateway: "aimock_loopback",
	loadedModels: "fake_lms_cli",
	gitRemotes: "sandbox_network_none",
	updateFeeds: "disabled",
	webEgress: "sandbox_network_none",
	triggerClock: "fixed_epoch",
	triggerFileWatches: "disabled",
	triggerTicks: "disabled_periodic",
	reviewDedupTimer: "disabled",
	watchdogTicks: "disabled_periodic",
	powerMode: "fixed_unknown",
	filesystemMtimes: "fixed_logical",
	runtimePort: "kernel_ephemeral_no_probe",
};

export function buildNightlyHermeticEvidence(input: {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly modelGatewayUrl: string;
	readonly lmsBin: string;
	readonly sandboxCapabilityPreset: string;
	readonly runtimePortMode: string;
}): NightlyHermeticEvidence {
	if (!isNightlyHermeticEnvironment(input.env)) throw new Error(`${NIGHTLY_HERMETIC_ENV}=1 is required`);
	let gateway: URL;
	try {
		gateway = new URL(input.modelGatewayUrl);
	} catch {
		throw new Error("model gateway must be a valid loopback URL");
	}
	if (gateway.protocol !== "http:" || gateway.hostname !== "127.0.0.1") {
		throw new Error("model gateway must be plain HTTP on 127.0.0.1");
	}
	if (!input.lmsBin.trim()) throw new Error("fake lms CLI path is required");
	if (input.env.NKLEIN_NO_AUTO_UPDATE !== "1") throw new Error("NKLEIN_NO_AUTO_UPDATE=1 is required");
	if (input.env.BASIC_MEMORY_AUTO_UPDATE !== "false") throw new Error("BASIC_MEMORY_AUTO_UPDATE=false is required");
	if (input.sandboxCapabilityPreset !== "strict") throw new Error("sandbox capability preset must be strict");
	if (input.runtimePortMode !== "ephemeral") throw new Error("runtime port mode must be ephemeral");
	return NIGHTLY_HERMETIC_EVIDENCE;
}

export function parseNightlyHermeticEvidence(raw: string): NightlyHermeticEvidence {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`hermetic evidence is not JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("hermetic evidence must be an object");
	}
	const record = value as Record<string, unknown>;
	for (const [key, expected] of Object.entries(NIGHTLY_HERMETIC_EVIDENCE)) {
		if (record[key] !== expected) {
			throw new Error(
				`hermetic evidence ${key} must be ${JSON.stringify(expected)}, got ${JSON.stringify(record[key])}`,
			);
		}
	}
	if (Object.keys(record).length !== Object.keys(NIGHTLY_HERMETIC_EVIDENCE).length) {
		throw new Error("hermetic evidence contains unknown fields");
	}
	return NIGHTLY_HERMETIC_EVIDENCE;
}
