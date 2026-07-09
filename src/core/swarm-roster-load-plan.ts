/**
 * Pure planning for effectful swarm-roster loads. The shipped rosters use generic machine classes, while a user's
 * `swarm-rosters.json` may use real LM Link names/ids. This module resolves those names before `model-lab` does any load.
 */

import type { LmsLinkDevices } from "./lms-link-status";
import { primaryAssignmentsByMachine, type RosterAssignment, type SwarmRoster } from "./swarm-roster";

const GiB = 1024 ** 3;

export interface RosterMachineMapParseResult {
	machineMap: Readonly<Record<string, string>>;
	issues: readonly string[];
}

export interface RosterLoadTarget {
	machine: string;
	resolvedMachine: string;
	targetDevice: string;
	targetDeviceIdentifier?: string;
	totalRamBytes: number;
	candidateSizeBytes: number;
	assignment: RosterAssignment;
}

export type RosterLoadPlan =
	| { ok: true; targets: readonly RosterLoadTarget[] }
	| { ok: false; issues: readonly string[] };

/**
 * Parse an optional JSON object mapping roster machine ids/classes to actual LM Link device names or ids.
 *
 * Example:
 * `{"workstation":"Local","desktop":"m4mini","laptop":"040891f3ad9352c2ec9389aba79cd022"}`
 */
export function parseRosterMachineMapEnv(raw: string | undefined): RosterMachineMapParseResult {
	const value = raw?.trim();
	if (!value) {
		return { machineMap: {}, issues: [] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		return {
			machineMap: {},
			issues: [
				`NKLEIN_ROSTER_MACHINE_MAP must be a JSON object: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { machineMap: {}, issues: ["NKLEIN_ROSTER_MACHINE_MAP must be a JSON object."] };
	}
	const machineMap: Record<string, string> = {};
	const issues: string[] = [];
	for (const [machine, target] of Object.entries(parsed)) {
		if (typeof target !== "string" || target.trim().length === 0) {
			issues.push(`NKLEIN_ROSTER_MACHINE_MAP.${machine} must be a non-empty string.`);
			continue;
		}
		machineMap[machine] = target.trim();
	}
	return { machineMap, issues };
}

export function resolveRosterLoadPlan(input: {
	roster: SwarmRoster;
	budgetsGb: Readonly<Record<string, number>>;
	linkDevices: LmsLinkDevices;
	machineMap?: Readonly<Record<string, string>>;
}): RosterLoadPlan {
	const assignments = [...primaryAssignmentsByMachine(input.roster).values()];
	const issues: string[] = [];
	const targets: RosterLoadTarget[] = [];

	for (const assignment of assignments) {
		const mappedMachine = input.machineMap?.[assignment.machine]?.trim();
		const resolvedMachine = mappedMachine && mappedMachine.length > 0 ? mappedMachine : assignment.machine;
		const budgetGb = input.budgetsGb[assignment.machine] ?? input.budgetsGb[resolvedMachine];
		if (!Number.isFinite(budgetGb) || budgetGb <= 0) {
			issues.push(`No positive machine budget configured for roster machine "${assignment.machine}".`);
			continue;
		}
		const target = resolveLmLinkTarget(resolvedMachine, input.linkDevices);
		if (!target) {
			issues.push(
				`Roster machine "${assignment.machine}" resolves to "${resolvedMachine}", which is neither Local, this host (${input.linkDevices.localMachineName ?? "unknown"}), a linked device name, nor a linked device id.`,
			);
			continue;
		}
		targets.push({
			machine: assignment.machine,
			resolvedMachine,
			targetDevice: target.targetDevice,
			targetDeviceIdentifier: target.targetDeviceIdentifier,
			totalRamBytes: Math.round(budgetGb * GiB),
			candidateSizeBytes: Math.round(assignment.approxSizeGb * GiB),
			assignment,
		});
	}

	return issues.length > 0 ? { ok: false, issues } : { ok: true, targets };
}

function resolveLmLinkTarget(
	machine: string,
	linkDevices: LmsLinkDevices,
): { targetDevice: string; targetDeviceIdentifier?: string } | null {
	if (machine === "Local" || machine.toLowerCase() === "local" || machine === linkDevices.localMachineName) {
		return { targetDevice: "Local" };
	}
	if (machine === linkDevices.localDeviceIdentifier) {
		return { targetDevice: "Local" };
	}
	if (linkDevices.namesByDeviceId.has(machine)) {
		return { targetDevice: linkDevices.namesByDeviceId.get(machine) ?? machine, targetDeviceIdentifier: machine };
	}
	for (const [deviceIdentifier, deviceName] of linkDevices.namesByDeviceId) {
		if (deviceName === machine) {
			return { targetDevice: deviceName, targetDeviceIdentifier: deviceIdentifier };
		}
	}
	return null;
}
