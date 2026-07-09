import type { LmsLinkDevices } from "./lms-link-status";
import { LOCAL_MACHINE_ID } from "./lms-ps-json";

export interface FleetHostCapIssue {
	entry: string;
	reason: string;
}

export interface FleetHostCapConfig {
	perHost: Record<string, number>;
	issues: FleetHostCapIssue[];
}

const MAX_CAP = 256;

function normalizeLookupKey(value: string): string {
	return value.trim().toLowerCase();
}

function addAlias(index: Map<string, string>, alias: string | null | undefined, hostId: string): void {
	const key = alias ? normalizeLookupKey(alias) : "";
	if (key) {
		index.set(key, hostId);
	}
}

function buildHostAliasIndex(devices: LmsLinkDevices): Map<string, string> {
	const index = new Map<string, string>();
	addAlias(index, LOCAL_MACHINE_ID, LOCAL_MACHINE_ID);
	addAlias(index, "localhost", LOCAL_MACHINE_ID);
	addAlias(index, devices.localMachineName, LOCAL_MACHINE_ID);
	addAlias(index, devices.localDeviceIdentifier, LOCAL_MACHINE_ID);
	for (const [deviceId, deviceName] of devices.namesByDeviceId) {
		addAlias(index, deviceId, deviceId);
		addAlias(index, deviceName, deviceId);
	}
	return index;
}

function resolveHostId(name: string, index: ReadonlyMap<string, string>): string | null {
	const key = normalizeLookupKey(name);
	const direct = index.get(key);
	if (direct) {
		return direct;
	}
	if (key.length < 6) {
		return null;
	}
	const prefixed = [...index.entries()].filter(([alias]) => alias.startsWith(key)).map(([, hostId]) => hostId);
	const unique = [...new Set(prefixed)];
	return unique.length === 1 ? unique[0] : null;
}

function parseCap(raw: string): number | null {
	const parsed = Number(raw.trim());
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
		return null;
	}
	return Math.min(MAX_CAP, parsed);
}

export function resolveFleetHostCapConfig(raw: string | undefined, devices: LmsLinkDevices): FleetHostCapConfig {
	const text = raw?.trim();
	if (!text) {
		return { perHost: {}, issues: [] };
	}
	const aliasIndex = buildHostAliasIndex(devices);
	const perHost: Record<string, number> = {};
	const issues: FleetHostCapIssue[] = [];
	const seenHosts = new Set<string>();
	for (const entry of text
		.split(/[,\n;]/)
		.map((part) => part.trim())
		.filter(Boolean)) {
		const match = /^([^:=]+)\s*[:=]\s*(\S+)$/.exec(entry);
		if (!match) {
			issues.push({ entry, reason: "expected host=cap or host:cap" });
			continue;
		}
		const [, rawHost, rawCap] = match;
		const hostId = resolveHostId(rawHost, aliasIndex);
		if (!hostId) {
			issues.push({ entry, reason: `unknown host "${rawHost.trim()}"` });
			continue;
		}
		const cap = parseCap(rawCap);
		if (cap === null) {
			issues.push({ entry, reason: `cap must be an integer from 1 to ${MAX_CAP}` });
			continue;
		}
		if (seenHosts.has(hostId)) {
			issues.push({ entry, reason: `duplicate cap for host "${hostId}"` });
			continue;
		}
		seenHosts.add(hostId);
		perHost[hostId] = cap;
	}
	return { perHost, issues };
}

export function formatFleetHostCapConfig(perHost: Record<string, number>, devices: LmsLinkDevices): string {
	const names = new Map<string, string>();
	names.set(
		LOCAL_MACHINE_ID,
		devices.localMachineName ? `${devices.localMachineName} (${LOCAL_MACHINE_ID})` : LOCAL_MACHINE_ID,
	);
	for (const [deviceId, deviceName] of devices.namesByDeviceId) {
		names.set(deviceId, `${deviceName} (${deviceId.slice(0, 8)})`);
	}
	const entries = Object.entries(perHost);
	if (entries.length === 0) {
		return "none";
	}
	return entries.map(([hostId, cap]) => `${names.get(hostId) ?? hostId}=${cap}`).join(", ");
}
