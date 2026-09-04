/**
 * Fleet identifier collisions (live 2026-09-04/05): the same LM Studio identifier loaded on TWO LM-Link hosts
 * (legion and the new M1 both served `dirk-qwen3.8-27b`) makes the gateway answer every request to it with
 * "Failed to resolve model metadata for <id>" (internal_error) — it cannot pick a host, so the id is
 * unroutable until one host renames its instance. Both the worker start path and the reviewer chooser draw
 * candidates from listings that happily show the id, so the exclusion has to be shared — the first fix went
 * into routing only and the un-parked reviews walked straight back into the collision.
 */

export interface FleetIdentifierInstance {
	readonly identifier: string;
	readonly machineId: string;
}

/** Identifiers present on more than one distinct machine, with the machines they sit on. */
export function machinesByIdentifier(instances: readonly FleetIdentifierInstance[]): Map<string, Set<string>> {
	const byIdentifier = new Map<string, Set<string>>();
	for (const instance of instances) {
		const machines = byIdentifier.get(instance.identifier) ?? new Set<string>();
		machines.add(instance.machineId);
		byIdentifier.set(instance.identifier, machines);
	}
	return byIdentifier;
}

export function collidingIdentifiers(instances: readonly FleetIdentifierInstance[]): Set<string> {
	return new Set(
		[...machinesByIdentifier(instances).entries()]
			.filter(([, machines]) => machines.size > 1)
			.map(([identifier]) => identifier),
	);
}

/** Operator-facing one-liner naming the hosts, for observations and park reasons. */
export function describeIdentifierCollision(identifier: string, instances: readonly FleetIdentifierInstance[]): string {
	const machines = [...(machinesByIdentifier(instances).get(identifier) ?? [])];
	return `${identifier} is loaded on ${machines.length} LM-Link hosts (${machines.join(" + ")}) — the gateway cannot route it; rename the instance on one host (e.g. lms load … --identifier ${identifier}@<host>)`;
}
