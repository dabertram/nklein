/**
 * `nklein dev sandbox-reap` — collect abandoned agent-sandbox containers and their workspace volumes.
 *
 * ── WHY A COMMAND AND NOT JUST STARTUP REAPING ──
 * Startup reaping only runs when a runtime starts, and it can only collect what it can PROVE is abandoned. Containers
 * created before ownership labels existed carry no claim at all, so nothing will ever prove them abandoned and they
 * accumulate forever. Measured on the dev host 2026-08-01: 22 containers (6 still RUNNING, oldest up 6 days) and 105
 * volumes of which 22 were active — 83 leaked workspaces — with no !Klein process alive to own any of them.
 *
 * Those need a human who knows no runtime is live. This is that seam, made first-class instead of leaving operators
 * to hand-roll `docker rm -f $(docker ps -aq …)` — which cannot tell a dead owner's container from a live one and
 * is exactly the kind-wide destructive query §4A forbids after the 2026-07-23 incident.
 *
 * ── THE SAFETY SHAPE ──
 *   · default            → reap only what OWNERSHIP proves abandoned (dead owner, recycled pid) plus the historical
 *                          unnamespaced names this manager already owned. Identical to startup reaping.
 *   · `--include-unowned`→ additionally reap containers carrying NO claim. Opt-in because it is the one decision not
 *                          backed by proof. It still cannot touch a container whose owner is ALIVE.
 *   · `--dry-run`        → print the plan and change nothing. Every verdict is printed either way, because a
 *                          destructive command that cannot say what it did, and why, is the 2026-07-23 incident.
 */

import { isProcessAlive } from "../core/process-identity";
import {
	planSandboxOrphanReaping,
	type SandboxContainerRecord,
	siblingWorkspaceVolumeName,
} from "../core/sandbox-orphan-ownership";
import {
	AGENT_SANDBOX_CONTAINER_LABEL,
	AGENT_SANDBOX_CONTAINER_PREFIX,
	AGENT_SANDBOX_OWNER_NONCE_LABEL_KEY,
	AGENT_SANDBOX_OWNER_PID_LABEL_KEY,
	AGENT_SANDBOX_VOLUME_PREFIX,
	CURRENT_SANDBOX_OWNER,
} from "../nklein-agent/nklein-agent-sandbox-docker";
import { isAgentSandboxContainerNameForNamespace } from "../nklein-agent/nklein-agent-sandbox-predicates";

export interface DevSandboxReapOptions {
	includeUnowned?: boolean;
	dryRun?: boolean;
	json?: boolean;
	/** Injected in tests so no docker is required; defaults to the real CLI. */
	runDocker?: (args: readonly string[]) => Promise<{ exitCode: number; stdout: string }>;
	log?: (line: string) => void;
}

async function defaultRunDocker(args: readonly string[]): Promise<{ exitCode: number; stdout: string }> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const run = promisify(execFile);
	return await run("docker", [...args], { timeout: 60_000 })
		.then(({ stdout }) => ({ exitCode: 0, stdout }))
		.catch((error: { stdout?: string }) => ({ exitCode: 1, stdout: error.stdout ?? "" }));
}

/** One docker call for names + owner labels — `{{.Label "k"}}` prints an empty string when the label is absent. */
function listFormat(): string {
	return `{{.Names}}\t{{.Label "${AGENT_SANDBOX_OWNER_PID_LABEL_KEY}"}}\t{{.Label "${AGENT_SANDBOX_OWNER_NONCE_LABEL_KEY}"}}`;
}

export function parseSandboxContainerListing(stdout: string): SandboxContainerRecord[] {
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line) => {
			const [name, ownerPid, ownerNonce] = line.split("\t");
			return name ? [{ name, ownerPid: ownerPid ?? null, ownerNonce: ownerNonce ?? null }] : [];
		});
}

export async function runDevSandboxReapCommand(options: DevSandboxReapOptions = {}): Promise<void> {
	const runDocker = options.runDocker ?? defaultRunDocker;
	const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));

	const listed = await runDocker([
		"ps",
		"-a",
		"--format",
		listFormat(),
		"--filter",
		`label=${AGENT_SANDBOX_CONTAINER_LABEL}`,
	]);
	if (listed.exitCode !== 0) {
		log("docker is unavailable or returned an error — nothing was inspected, and nothing was removed.");
		return;
	}

	const records = parseSandboxContainerListing(listed.stdout);
	const plan = planSandboxOrphanReaping({
		records,
		self: CURRENT_SANDBOX_OWNER,
		isPidAlive: isProcessAlive,
		// A standalone command owns no pool, so it carries no namespace: it matches only the historical unnamespaced
		// shape, exactly as an unnamespaced startup manager does.
		matchesOwnNamespace: (name) => isAgentSandboxContainerNameForNamespace(name),
		...(options.includeUnowned ? { treatUnownedAsAbandoned: true } : {}),
	});

	if (options.json) {
		log(
			JSON.stringify(
				{ dryRun: Boolean(options.dryRun), includeUnowned: Boolean(options.includeUnowned), ...plan },
				null,
				2,
			),
		);
	} else {
		log(plan.summary);
		for (const decision of plan.decisions) {
			log(`  ${decision.reap ? "REAP" : "keep"}  ${decision.name}  (${decision.verdict})`);
		}
		if (!options.includeUnowned && plan.decisions.some((d) => d.verdict === "keep_legacy_foreign_namespace")) {
			log(
				"\nSome containers carry NO owner claim, so nothing can prove they are abandoned — they predate ownership\n" +
					"labels. With no !Klein runtime running, re-run with --include-unowned to collect them too.",
			);
		}
	}

	if (options.dryRun) {
		log(`\nDRY RUN — nothing was removed. ${plan.reapNames.length} container(s) would be.`);
		return;
	}

	let removedContainers = 0;
	let removedVolumes = 0;
	for (const name of plan.reapNames) {
		if ((await runDocker(["rm", "-f", name])).exitCode === 0) {
			removedContainers += 1;
		}
		// Implicit `docker run -v` volumes carry no labels of their own and are reachable only through the
		// container's verdict; reaping the container alone would leave the workspace behind.
		const volumeName = siblingWorkspaceVolumeName({
			containerName: name,
			containerPrefix: AGENT_SANDBOX_CONTAINER_PREFIX,
			volumePrefix: AGENT_SANDBOX_VOLUME_PREFIX,
		});
		if (volumeName && (await runDocker(["volume", "rm", volumeName])).exitCode === 0) {
			removedVolumes += 1;
		}
	}
	// A volume whose CONTAINER is already gone is unreachable by the verdict path above — that path pairs the two, and
	// pairing only works while both still exist. On the dev host that left 76 workspace volumes behind after the 22
	// containers were collected: half the leak, invisible to the half that got fixed.
	//
	// `--dangling=true` restricts this to volumes no container references at all, and `docker volume rm` REFUSES an
	// attached volume — so the operation cannot take a workspace out from under a running agent even if the operator
	// is wrong about the host being quiet. That safety is why this rides the same opt-in rather than needing its own.
	let removedDangling = 0;
	if (options.includeUnowned) {
		const dangling = await runDocker([
			"volume",
			"ls",
			"-q",
			"--filter",
			"dangling=true",
			"--filter",
			`name=${AGENT_SANDBOX_VOLUME_PREFIX}`,
		]);
		const names =
			dangling.exitCode === 0
				? dangling.stdout
						.split(/\r?\n/)
						.map((name) => name.trim())
						.filter(Boolean)
				: [];
		for (const name of names) {
			if ((await runDocker(["volume", "rm", name])).exitCode === 0) {
				removedDangling += 1;
			}
		}
		if (names.length > 0) {
			log(
				`Removed ${removedDangling}/${names.length} orphaned workspace volume(s) whose container was already gone.`,
			);
		}
	}

	log(`\nRemoved ${removedContainers} container(s) and ${removedVolumes + removedDangling} workspace volume(s).`);
}
