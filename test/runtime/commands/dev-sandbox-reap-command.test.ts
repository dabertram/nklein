import { describe, expect, it } from "vitest";
import { parseSandboxContainerListing, runDevSandboxReapCommand } from "../../../src/commands/dev-sandbox-reap-command";

/**
 * `dev sandbox-reap` — the operator seam for leftovers that ownership cannot judge.
 *
 * Containers created before ownership labels existed carry no claim, so nothing will ever PROVE them abandoned and
 * they accumulate forever (22 containers / 83 volumes measured on the dev host, 2026-08-01). The alternative an
 * operator would otherwise reach for — `docker rm -f $(docker ps -aq --filter label=…)` — is precisely the kind-wide
 * destructive query §4A forbids: it cannot tell a dead owner's container from a live one.
 */

function docker(listing: string) {
	const calls: string[][] = [];
	return {
		calls,
		run: async (args: readonly string[]) => {
			calls.push([...args]);
			return { exitCode: 0, stdout: args[0] === "ps" ? listing : "" };
		},
	};
}

function collect() {
	const lines: string[] = [];
	return { lines, log: (line: string) => lines.push(line) };
}

const DEAD = 999_999;

describe("runDevSandboxReapCommand", () => {
	it("reaps a dead owner's container AND its workspace volume", async () => {
		const fake = docker(`nklein-agent-sandbox-simflow-1-ephemeral-ws-abc-1\t${DEAD}\tboot-dead\n`);
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log });

		expect(fake.calls).toContainEqual(["rm", "-f", "nklein-agent-sandbox-simflow-1-ephemeral-ws-abc-1"]);
		expect(fake.calls).toContainEqual(["volume", "rm", "nklein-agent-ws-simflow-1-ephemeral-ws-abc-1"]);
		expect(out.lines.join("\n")).toMatch(/Removed 1 container\(s\) and 1 workspace volume\(s\)/u);
	});

	it("leaves an UNOWNED container alone by default — it cannot be proven abandoned", async () => {
		const fake = docker("nklein-agent-sandbox-simflow-1-ephemeral-ws-abc-1\t\t\n");
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log });

		expect(fake.calls.some((call) => call[0] === "rm")).toBe(false);
		expect(out.lines.join("\n")).toMatch(/keep_legacy_foreign_namespace/u);
	});

	it("says how to collect unowned leftovers instead of leaving the operator to guess", async () => {
		const fake = docker("nklein-agent-sandbox-simflow-1-ephemeral-ws-abc-1\t\t\n");
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log });
		expect(out.lines.join("\n")).toMatch(/--include-unowned/u);
	});

	it("reaps unowned containers only when explicitly asked", async () => {
		const fake = docker("nklein-agent-sandbox-simflow-1-ephemeral-ws-abc-1\t\t\n");
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log, includeUnowned: true });

		expect(fake.calls).toContainEqual(["rm", "-f", "nklein-agent-sandbox-simflow-1-ephemeral-ws-abc-1"]);
		expect(out.lines.join("\n")).toMatch(/reap_unowned_operator_forced/u);
	});

	it("NEVER reaps a live owner's container, even with --include-unowned", async () => {
		// The flag widens the set to "unprovable", never to "provably in use". `process.ppid` is a real live pid.
		const fake = docker(`nklein-agent-sandbox-a-1\t${process.ppid}\tboot-live\n`);
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log, includeUnowned: true });

		expect(fake.calls.some((call) => call[0] === "rm")).toBe(false);
		expect(out.lines.join("\n")).toMatch(/keep_owner_alive/u);
	});

	it("removes NOTHING on --dry-run, while still printing the full plan", async () => {
		const fake = docker(`nklein-agent-sandbox-x-1\t${DEAD}\tboot-dead\n`);
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log, dryRun: true });

		expect(fake.calls.some((call) => call[0] === "rm")).toBe(false);
		expect(out.lines.join("\n")).toMatch(/DRY RUN — nothing was removed\. 1 container\(s\) would be/u);
	});

	it("prints a verdict for EVERY container, kept ones included", async () => {
		// A destructive command that cannot say what it did, and why, is how the 2026-07-23 incident stayed invisible.
		const fake = docker(
			`nklein-agent-sandbox-dead-ws-a-1\t${DEAD}\tboot-dead\n` +
				`nklein-agent-sandbox-live-ws-b-1\t${process.ppid}\tboot-live\n`,
		);
		const out = collect();
		await runDevSandboxReapCommand({ runDocker: fake.run, log: out.log, dryRun: true });

		const text = out.lines.join("\n");
		expect(text).toMatch(/REAP {2}nklein-agent-sandbox-dead-ws-a-1 {2}\(reap_owner_dead\)/u);
		expect(text).toMatch(/keep {2}nklein-agent-sandbox-live-ws-b-1 {2}\(keep_owner_alive\)/u);
	});

	it("collects DANGLING workspace volumes whose container is already gone, under --include-unowned", async () => {
		// The verdict path pairs a container with its volume, which only works while both exist. On the dev host that
		// left 76 volumes behind after the 22 containers were collected — half the leak, invisible to the other half.
		const calls: string[][] = [];
		await runDevSandboxReapCommand({
			log: collect().log,
			includeUnowned: true,
			runDocker: async (args) => {
				calls.push([...args]);
				if (args[0] === "ps") return { exitCode: 0, stdout: "" };
				if (args[0] === "volume" && args[1] === "ls") return { exitCode: 0, stdout: "nklein-agent-ws-old-1\n" };
				return { exitCode: 0, stdout: "" };
			},
		});
		expect(calls).toContainEqual(["volume", "rm", "nklein-agent-ws-old-1"]);
		const list = calls.find((call) => call[0] === "volume" && call[1] === "ls");
		expect(list, "must restrict to volumes NO container references").toContain("dangling=true");
	});

	it("does NOT touch dangling volumes by default", async () => {
		const fake = docker("");
		await runDevSandboxReapCommand({ runDocker: fake.run, log: collect().log });
		expect(fake.calls.some((call) => call[0] === "volume" && call[1] === "ls")).toBe(false);
	});

	it("removes nothing when docker is unavailable, and says so", async () => {
		const calls: string[][] = [];
		const out = collect();
		await runDevSandboxReapCommand({
			log: out.log,
			runDocker: async (args) => {
				calls.push([...args]);
				return { exitCode: 1, stdout: "" };
			},
		});
		expect(calls.some((call) => call[0] === "rm")).toBe(false);
		expect(out.lines.join("\n")).toMatch(/docker is unavailable/u);
	});

	it("asks docker for the owner labels, or every container would read as unowned", async () => {
		const fake = docker("");
		await runDevSandboxReapCommand({ runDocker: fake.run, log: collect().log });
		const ps = fake.calls.find((call) => call[0] === "ps");
		expect(ps?.[3]).toContain('{{.Label "nklein.owner-pid"}}');
		expect(ps?.[3]).toContain('{{.Label "nklein.owner-nonce"}}');
	});
});

describe("parseSandboxContainerListing", () => {
	it("reads docker's EMPTY label columns as absent rather than as a claim", () => {
		// Trimming the line collapses the empty trailing columns away entirely, so they arrive as `null` rather than
		// `""`. Harmless — the classifier treats both as "no claim" — but worth pinning, because the two encodings
		// reaching the same verdict is the property that keeps an unlabeled container off the ownership path.
		expect(parseSandboxContainerListing("name-a\t\t\n")).toEqual([
			{ name: "name-a", ownerPid: null, ownerNonce: null },
		]);
	});

	it("treats a HALF-written claim (pid, no nonce) as absent too", () => {
		expect(parseSandboxContainerListing("name-a\t123\t")).toEqual([
			{ name: "name-a", ownerPid: "123", ownerNonce: null },
		]);
	});

	it("ignores blank lines", () => {
		expect(parseSandboxContainerListing("\n\n  \n")).toEqual([]);
	});

	it("keeps both label columns when present", () => {
		expect(parseSandboxContainerListing("n\t12\tnonce-x")).toEqual([
			{ name: "n", ownerPid: "12", ownerNonce: "nonce-x" },
		]);
	});
});
