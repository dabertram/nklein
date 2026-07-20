/**
 * `nklein dev env-gated` — which requirement deliverables may not run at all by default?
 *
 * F4.8b. The existing audits answer "is this imported by live code?". F4.8 showed that is the weaker claim: a
 * complete import chain to the session runtime, an injection site behind a default-OFF flag, and every audit
 * reporting the requirement satisfied while nothing reached a prompt.
 *
 * Excludes its own core and this file for the reason §4A now records four times over: an audit that can see its
 * own declarations verifies nothing.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditEnvGatedDelivery, type DeliverableConsumers, findEnvGuardFlags } from "../core/env-gated-delivery";
import { MECHANISM_REGISTRY } from "../core/mechanism-observation-audit";
import { TRACKED_REQUIREMENTS } from "../core/tracked-requirements";

const EXCLUDED = ["env-gated-delivery.ts", "dev-env-gated-command.ts", "tracked-requirements.ts"];

async function readSourceFiles(root: string): Promise<{ path: string; text: string }[]> {
	const out: { path: string; text: string }[] = [];
	async function walk(dir: string): Promise<void> {
		for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !EXCLUDED.includes(entry.name)) {
				out.push({ path: full, text: await readFile(full, "utf8").catch(() => "") });
			}
		}
	}
	await walk(root);
	return out;
}

export async function runDevEnvGatedCommand(options: { json?: boolean }): Promise<void> {
	const files = await readSourceFiles("src");

	const deliverables: DeliverableConsumers[] = [];
	for (const requirement of TRACKED_REQUIREMENTS) {
		for (const element of requirement.elements) {
			const moduleName = element.providedBy?.module;
			const symbol = element.providedBy?.symbol;
			if (!moduleName || !symbol) {
				continue;
			}
			const moduleStem = moduleName.replace(/\.ts$/, "");
			// A consumer imports the module AND names the symbol. Requiring both keeps a file that merely mentions
			// the name in a comment from counting as a consumer.
			const consumers = files.filter(
				(file) => !file.path.endsWith(moduleName) && file.text.includes(moduleStem) && file.text.includes(symbol),
			);
			deliverables.push({ element: element.element, module: moduleName, consumers });
		}
	}

	// Cross-check against the hand-maintained registry rather than shadowing it. P15.1b already distinguishes
	// "never enabled" from "enabled but silent"; what it cannot do is report on a mechanism nobody added — which
	// is exactly how F4.8's goal re-anchor stayed invisible.
	const registeredFlags = MECHANISM_REGISTRY.map((entry) => entry.enabledBy).filter(
		(flag): flag is string => flag !== null,
	);
	const audit = auditEnvGatedDelivery(deliverables, registeredFlags);

	// Every flag in the codebase, not just those reachable from a tracked requirement — the registry's blind spot
	// is wider than the requirement map.
	const allFlags = [...new Set(files.flatMap((file) => findEnvGuardFlags(file.text)))].sort();
	const unregisteredEverywhere = allFlags.filter((flag) => !registeredFlags.includes(flag));

	if (options.json) {
		process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
		return;
	}

	process.stdout.write("DELIVERABLES THAT MAY NOT RUN BY DEFAULT (F4.8b)\n\n");
	for (const suspicion of audit.suspicions) {
		if (suspicion.exposure === "none") {
			continue;
		}
		const mark = suspicion.exposure === "all" ? "⚠️ " : suspicion.exposure === "no_consumers" ? "✗ " : "· ";
		process.stdout.write(`${mark}${suspicion.element} [${suspicion.module}]\n    ${suspicion.note}\n`);
	}
	process.stdout.write(`\n${audit.summary}\n`);
	process.stdout.write(
		`\nREGISTRY COVERAGE: ${registeredFlags.length} of ${allFlags.length} default-OFF flag(s) are in MECHANISM_REGISTRY.\n` +
			`${unregisteredEverywhere.length} are NOT, so nothing can report whether they are on or what they should be firing:\n` +
			`  ${unregisteredEverywhere.join(", ")}\n` +
			"A hand-maintained registry cannot report on what nobody added — that is exactly how F4.8's goal\n" +
			"re-anchor stayed invisible while every audit called the requirement satisfied.\n",
	);
}
