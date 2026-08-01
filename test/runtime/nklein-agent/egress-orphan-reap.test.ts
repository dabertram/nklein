import { describe, expect, it } from "vitest";
import { EGRESS_NETWORK_LABEL, reapOrphanEgressProxies } from "../../../src/nklein-agent/egress-proxy-lifecycle";

/**
 * The egress half of the 2026-08-01 ownership audit.
 *
 * `teardownEgressProxy` was reachable from exactly ONE place — `stopNow`, gated on an in-memory flag — so a SIGKILLed
 * runtime stranded the proxy container AND its `--internal` network permanently, under a namespaced name no later
 * runtime would ever reclaim. Two comments asserted a `nklein.kind=egress-proxy` startup reap handled it; the label
 * was written and never queried by anything. The mechanism existed only in prose.
 *
 * The network is the worse half: Docker's default address pool is finite, so enough leaked `--internal` networks make
 * `docker network create` fail for the entire host, in every project.
 */

function fakeDocker(options: { containers?: string; networks?: string } = {}) {
	const calls: string[][] = [];
	return {
		calls,
		run: async (argv: readonly string[]) => {
			calls.push([...argv]);
			if (argv[0] === "ps") return { exitCode: 0, stdout: options.containers ?? "", stderr: "" };
			if (argv[0] === "network" && argv[1] === "ls")
				return { exitCode: 0, stdout: options.networks ?? "", stderr: "" };
			return { exitCode: 0, stdout: "", stderr: "" };
		},
	};
}

/** Reap everything the caller lists — stands in for the ownership plan, which has its own tests. */
const reapAll = (records: readonly { name: string }[]) => ({ reapNames: records.map((record) => record.name) });
const reapNone = () => ({ reapNames: [] as string[] });

describe("reapOrphanEgressProxies", () => {
	it("removes an abandoned proxy container", async () => {
		const docker = fakeDocker({ containers: "nklein-egress-proxy-simflow-1\t999999\tboot-dead\n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapAll });
		expect(docker.calls).toContainEqual(["rm", "-f", "nklein-egress-proxy-simflow-1"]);
	});

	it("asks docker for the OWNER LABELS, not just names", async () => {
		// Without them every proxy reads as unowned and the ownership path is dead code.
		const docker = fakeDocker();
		await reapOrphanEgressProxies(docker.run, { plan: reapNone });
		const ps = docker.calls.find((call) => call[0] === "ps");
		expect(ps?.[3]).toContain('{{.Label "nklein.owner-pid"}}');
		expect(ps?.[3]).toContain('{{.Label "nklein.owner-nonce"}}');
		expect(ps).toContainEqual("label=nklein.kind=egress-proxy");
	});

	it("sweeps egress networks by label — the half that exhausts Docker's address pool", async () => {
		const docker = fakeDocker({ networks: "netid-a\nnetid-b\n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapNone });
		expect(docker.calls).toContainEqual(["network", "rm", "netid-a"]);
		expect(docker.calls).toContainEqual(["network", "rm", "netid-b"]);
		const list = docker.calls.find((call) => call[0] === "network" && call[1] === "ls");
		expect(list).toContainEqual(`label=${EGRESS_NETWORK_LABEL}`);
	});

	it("removes CONTAINERS BEFORE NETWORKS — a network with an attached endpoint cannot be removed", async () => {
		// Ordering is the whole reason the network sweep can be label-wide and still safe: docker refuses to remove a
		// network that still has endpoints, and removing the dead owner's container first is what frees its own.
		const docker = fakeDocker({ containers: "nklein-egress-proxy-a\t999999\tboot-dead\n", networks: "netid-a\n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapAll });
		const rmIndex = docker.calls.findIndex((call) => call[0] === "rm");
		const netIndex = docker.calls.findIndex((call) => call[0] === "network" && call[1] === "rm");
		expect(rmIndex).toBeGreaterThanOrEqual(0);
		expect(netIndex).toBeGreaterThan(rmIndex);
	});

	it("keeps a proxy the ownership plan does not condemn", async () => {
		const docker = fakeDocker({ containers: "nklein-egress-proxy-live\t1\tboot-live\n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapNone });
		expect(docker.calls.some((call) => call[0] === "rm")).toBe(false);
	});

	it("still sweeps networks when the container listing fails", async () => {
		// A docker hiccup on the container query must not strand the address-pool half indefinitely.
		const calls: string[][] = [];
		await reapOrphanEgressProxies(
			async (argv) => {
				calls.push([...argv]);
				if (argv[0] === "ps") return { exitCode: 1, stdout: "", stderr: "boom" };
				if (argv[0] === "network" && argv[1] === "ls") return { exitCode: 0, stdout: "netid-a\n", stderr: "" };
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			{ plan: reapNone },
		);
		expect(calls).toContainEqual(["network", "rm", "netid-a"]);
	});

	it("survives docker being absent entirely", async () => {
		await expect(
			reapOrphanEgressProxies(
				async () => {
					throw new Error("docker not found");
				},
				{ plan: reapNone },
			),
		).resolves.toBeUndefined();
	});

	it("announces a destructive sweep instead of doing it silently", async () => {
		const warnings: string[] = [];
		const docker = fakeDocker({ containers: "nklein-egress-proxy-a\t999999\tboot-dead\n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapAll, warn: (message) => warnings.push(message) });
		expect(warnings.join("\n")).toMatch(/Egress orphan reap/u);
	});

	it("says nothing when there is nothing to reap", async () => {
		const warnings: string[] = [];
		const docker = fakeDocker({ containers: "nklein-egress-proxy-a\t1\tboot-live\n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapNone, warn: (message) => warnings.push(message) });
		expect(warnings).toEqual([]);
	});

	it("ignores blank listing lines rather than issuing an rm with an empty name", async () => {
		const docker = fakeDocker({ containers: "\n\n  \n", networks: "\n \n" });
		await reapOrphanEgressProxies(docker.run, { plan: reapAll });
		expect(docker.calls.some((call) => call[0] === "rm")).toBe(false);
		expect(docker.calls.some((call) => call[0] === "network" && call[1] === "rm")).toBe(false);
	});
});
