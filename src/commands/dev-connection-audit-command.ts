/**
 * `nklein dev connection-audit` — N15's local-only assertion, judged from recorded samples.
 *
 * Input: a file of accumulated `lsof -nP -iTCP -sTCP:ESTABLISHED` output (the drain orchestrator's
 * egress-audit sampler appends one block per poll). Output: the strict verdict from
 * `runtime-connection-audit.ts` — loopback-only passes, everything else fails unless explicitly
 * `--allow`ed. Exit code 1 on violations AND on an empty sample set (a sampler that saw nothing is
 * broken, not clean — silence is never success).
 */

import { readFile } from "node:fs/promises";
import {
	buildConnectionAuditVerdict,
	type ObservedTcpConnection,
	parseLsofEstablishedLine,
} from "../core/runtime-connection-audit";

export async function runDevConnectionAuditCommand(options: {
	samples?: string;
	allow?: string;
	json?: boolean;
}): Promise<void> {
	if (!options.samples) {
		process.stderr.write("--samples <file> is required (accumulated lsof -nP -iTCP -sTCP:ESTABLISHED output).\n");
		process.exitCode = 1;
		return;
	}
	let raw: string;
	try {
		raw = await readFile(options.samples, "utf8");
	} catch {
		process.stderr.write(`Could not read ${options.samples}.\n`);
		process.exitCode = 1;
		return;
	}
	const observations = raw
		.split("\n")
		.map(parseLsofEstablishedLine)
		.filter((row): row is ObservedTcpConnection => row !== null);
	const allowedRemoteHosts = (options.allow ?? "")
		.split(",")
		.map((host) => host.trim())
		.filter((host) => host.length > 0);
	const verdict = buildConnectionAuditVerdict(observations, { allowedRemoteHosts });
	if (options.json) {
		process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
	} else if (verdict.observedConnections === 0) {
		process.stdout.write(
			"CONNECTION AUDIT: INDETERMINATE — zero connections observed (sampler broken or never ran).\n",
		);
	} else if (verdict.ok) {
		process.stdout.write(
			`CONNECTION AUDIT: PASS — ${verdict.observedConnections} observation(s), every destination loopback${allowedRemoteHosts.length > 0 ? " or allowlisted" : ""}.\n`,
		);
	} else {
		process.stdout.write(`CONNECTION AUDIT: FAIL — ${verdict.violations.length} non-loopback destination(s):\n`);
		for (const violation of verdict.violations) {
			process.stdout.write(
				`  ${violation.command} (pid ${violation.pid}) -> ${violation.remoteHost}:${violation.remotePort} (${violation.observations} sighting(s))\n`,
			);
		}
	}
	// INDETERMINATE is a failure exit too: a run must prove its sampler saw traffic (loopback counts).
	if (!verdict.ok || verdict.observedConnections === 0) {
		process.exitCode = 1;
	}
}
