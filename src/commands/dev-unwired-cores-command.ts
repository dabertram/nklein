import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { auditUnwiredCores, type ExportedSymbol, extractExportedSymbols } from "../core/unwired-core-audit";

/**
 * P15.1 — `nklein dev unwired-cores`: list exported core symbols with no non-test consumer.
 *
 * The scan is the cheap mechanical signal behind the charter's "mechanisms have outrun proof" concession. It
 * reads every file ONCE (a per-symbol grep is O(symbols × tree) and took >10 minutes on this repo) and
 * classifies each reference as real code or a comment mention — the distinction that makes a plain grep count
 * wrong, since a docblock reference reports an unwired symbol as wired.
 */

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

function walkSources(dir: string, out: string[] = []): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry) || entry.startsWith(".")) {
			continue;
		}
		const path = join(dir, entry);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			walkSources(path, out);
		} else if ((path.endsWith(".ts") || path.endsWith(".tsx")) && !path.includes(".test.")) {
			out.push(path);
		}
	}
	return out;
}

export async function runDevUnwiredCoresCommand(options: {
	json?: boolean;
	module?: string;
	roots?: readonly string[];
}): Promise<void> {
	const coreDir = "src/core";
	const coreFiles = readdirSync(coreDir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
	const symbols: ExportedSymbol[] = [];
	for (const file of coreFiles) {
		if (options.module && file !== options.module) {
			continue;
		}
		symbols.push(...extractExportedSymbols(file, readFileSync(join(coreDir, file), "utf8")));
	}
	const byName = new Map<string, ExportedSymbol[]>();
	for (const symbol of symbols) {
		const bucket = byName.get(symbol.name) ?? [];
		bucket.push(symbol);
		byName.set(symbol.name, bucket);
	}

	const roots = options.roots ?? ["src", "web-ui/src", "packages"];
	const referenceLines = new Map<string, string[]>();
	for (const file of roots.flatMap((root) => walkSources(root))) {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			for (const [name, defs] of byName) {
				if (!line.includes(name)) {
					continue;
				}
				for (const def of defs) {
					if (file === join(coreDir, def.module)) {
						continue;
					}
					const key = `${def.module}::${def.name}`;
					const bucket = referenceLines.get(key) ?? [];
					bucket.push(line);
					referenceLines.set(key, bucket);
				}
			}
		}
	}

	const result = auditUnwiredCores({ symbols, referenceLines });
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${result.summary}\n`);
	if (result.commentOnlyOrphans.length > 0) {
		process.stdout.write("\nCOMMENT-ONLY references (a plain grep count reports these as WIRED):\n");
		for (const orphan of result.commentOnlyOrphans) {
			process.stdout.write(`  ${orphan.module} :: ${orphan.name}  (${orphan.commentOnlyMentions} mention(s))\n`);
		}
	}
	const perModule = new Map<string, number>();
	const totalPerModule = new Map<string, number>();
	for (const symbol of symbols) {
		totalPerModule.set(symbol.module, (totalPerModule.get(symbol.module) ?? 0) + 1);
	}
	for (const orphan of result.orphans) {
		perModule.set(orphan.module, (perModule.get(orphan.module) ?? 0) + 1);
	}
	const fully = [...perModule.entries()]
		.filter(([module, count]) => count === totalPerModule.get(module))
		.sort((left, right) => right[1] - left[1]);
	if (fully.length > 0) {
		process.stdout.write(`\nModules where EVERY export is orphaned (${fully.length}):\n`);
		for (const [module, count] of fully) {
			process.stdout.write(`  ${module} (${count} export(s))\n`);
		}
	}
	process.stdout.write(
		"\nEach entry is a QUESTION, not a verdict. An orphan may be a core awaiting its wire, a deliberate public API,\nor a core whose lesson was the point. This scan is text-level and can miss re-exports and dynamic lookups.\n",
	);
}
