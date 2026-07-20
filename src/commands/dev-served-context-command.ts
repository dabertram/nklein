/**
 * `nklein dev served-context` — is this endpoint's advertised context real, or does it silently truncate? (P21.3)
 *
 * The verdict is pure; the PROBE (sending a prompt and reading back how much the model saw) is effectful and
 * needs a live endpoint (P21.3b). This command applies the decision to numbers you supply — the advertised
 * window and, when you have probed it, the served length — so the routing rule ("never route on an unverified or
 * silently-truncated window") is checkable, and the exit code says whether routing is safe.
 */

import { assessServedContext } from "../core/served-context-assertion";

export function runDevServedContextCommand(options: {
	advertised?: string;
	probed?: string;
	tolerance?: string;
	json?: boolean;
}): void {
	const advertised = Number.parseInt(options.advertised ?? "", 10);
	if (!Number.isFinite(advertised) || advertised <= 0) {
		process.stdout.write(
			"usage: dev served-context --advertised <tokens> [--probed <tokens>] [--tolerance <0..1>]\n" +
				"  Omit --probed to see the safety default: an unprobed window is NOT routable.\n",
		);
		process.exitCode = 2;
		return;
	}
	const probedRaw = options.probed !== undefined ? Number.parseInt(options.probed, 10) : Number.NaN;
	const assessment = assessServedContext({
		advertisedContextTokens: advertised,
		probedServedContextTokens: Number.isFinite(probedRaw) ? probedRaw : null,
		...(options.tolerance !== undefined ? { tolerance: Number.parseFloat(options.tolerance) } : {}),
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
		process.exitCode = assessment.routable ? 0 : 1;
		return;
	}
	process.stdout.write(`SERVED CONTEXT: ${assessment.verdict.toUpperCase()} (routable: ${assessment.routable})\n`);
	process.stdout.write(`  safe to use: ${assessment.safeContextTokens} token(s)\n\n${assessment.reason}\n`);
	process.exitCode = assessment.routable ? 0 : 1;
}
