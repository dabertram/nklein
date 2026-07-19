import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSbomFromLockfile, renderCycloneDxJson, renderSbomSummary } from "../core/sbom-generation";

/**
 * F12.102 — `nklein dev sbom`: build the app's Software Bill of Materials from its npm lockfile. Prints the
 * operator summary by default (which STATES the unknown-license and missing-digest gaps) or the CycloneDX
 * document with `--json`, which a user can verify before install.
 */
export async function runDevSbomCommand(options: {
	lockfile?: string;
	json?: boolean;
	name?: string;
	version?: string;
}): Promise<void> {
	const lockfilePath = options.lockfile ?? join(process.cwd(), "package-lock.json");
	const raw = await readFile(lockfilePath, "utf8").catch(() => null);
	if (raw === null) {
		process.stderr.write(`Could not read lockfile at ${lockfilePath}\n`);
		process.exitCode = 1;
		return;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		process.stderr.write(`Lockfile at ${lockfilePath} is not valid JSON: ${String(error)}\n`);
		process.exitCode = 1;
		return;
	}
	const sbom = buildSbomFromLockfile(parsed);
	if (sbom.components.length === 0) {
		process.stderr.write(`No components found in ${lockfilePath} — is it an npm lockfile (v2/v3)?\n`);
		process.exitCode = 1;
		return;
	}
	if (options.json) {
		process.stdout.write(renderCycloneDxJson(sbom, options.name ?? "nklein", options.version ?? "0.0.0"));
		return;
	}
	process.stdout.write(`${renderSbomSummary(sbom)}\n`);
}
