import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CapabilityEntry, extractCapability, searchCapabilities } from "../core/capability-index";

/**
 * `nklein dev capability-index [--search <q>] [--out <path>]`.
 *
 * Answers "does something already do X?" BEFORE X gets written. Three near-duplications in one session
 * (F12.28/F12.41, F12.82/F12.28, P20.2/diagnostic-oracles) all traced to built capability nobody could find.
 */

function collectEntries(): CapabilityEntry[] {
	const coreDir = "src/core";
	return readdirSync(coreDir)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.sort()
		.map((file) => extractCapability(file, readFileSync(join(coreDir, file), "utf8")));
}

export async function runDevCapabilityIndexCommand(options: {
	search?: string;
	out?: string;
	json?: boolean;
}): Promise<void> {
	const entries = collectEntries();

	if (options.search) {
		const hits = searchCapabilities(entries, options.search);
		if (options.json) {
			process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
			return;
		}
		if (hits.length === 0) {
			process.stdout.write(
				`No core matches "${options.search}". That is weak evidence of absence, not proof — the index reads docblocks only, so a module whose purpose is phrased differently will not match.\n`,
			);
			return;
		}
		process.stdout.write(`${hits.length} core(s) match "${options.search}":\n\n`);
		for (const entry of hits) {
			process.stdout.write(`  ${entry.module}${entry.labels.length > 0 ? `  [${entry.labels.join(" ")}]` : ""}\n`);
			process.stdout.write(`      ${entry.purpose}\n`);
			if (entry.exports.length > 0) {
				process.stdout.write(`      exports: ${entry.exports.slice(0, 6).join(", ")}\n`);
			}
			process.stdout.write("\n");
		}
		return;
	}

	const outPath = options.out ?? "docs/dev/core-capability-index.md";
	const doc = [
		"# Core capability index",
		"",
		"> **GENERATED — do not edit by hand.** Regenerate with `nklein dev capability-index`.",
		"> Search it with `nklein dev capability-index --search <term>` **before writing a new core**.",
		"",
		"## Why this exists",
		"",
		"One session produced three near-duplications: a significance test reimplemented (more weakly) beside the",
		"existing one, an optimizer nearly duplicated, and two evaluation items specified from scratch when a core",
		"written two weeks earlier already implemented their verdict logic.",
		"",
		"The cause was not dead code — it was **discoverability**. A long orphan list reads as *too much unused",
		"code*; the accurate reading is *a lot of built capability nobody can find*. Deleting it destroys value;",
		"indexing it recovers value.",
		"",
		`${entries.length} core modules.`,
		"",
		"| module | purpose | labels |",
		"| --- | --- | --- |",
		...entries.map(
			(entry) =>
				`| \`${entry.module}\` | ${entry.purpose.replace(/\|/g, "\\|")} | ${entry.labels.join(" ") || "—"} |`,
		),
		"",
	].join("\n");

	writeFileSync(outPath, doc, "utf8");
	process.stdout.write(`Wrote ${outPath} (${entries.length} cores).\n`);
}
