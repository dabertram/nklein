/**
 * P1.SWEBENCHFULL — the on-disk spec table (`.nklein-bench/swebench/specs.json`, written by
 * `scripts/swebench-specs.mts fetch`, the explicit egress step). Hermetic by refusal like the rest of the cache:
 * an absent table resolves to `null` and every consumer names the fetch command instead of guessing an env.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSwebenchSpecDump, type SwebenchSpecTable } from "./swebench-env-spec";

export function swebenchSpecTablePath(cacheRoot: string): string {
	return join(cacheRoot, "specs.json");
}

export const SWEBENCH_SPECS_FETCH_REMEDY =
	"run `tsx scripts/swebench-specs.mts fetch` (explicit egress step: the swebench PyPI package)";

/** The table, or null when it was never fetched (callers refuse with {@link SWEBENCH_SPECS_FETCH_REMEDY}). */
export async function loadSwebenchSpecTable(cacheRoot: string): Promise<SwebenchSpecTable | null> {
	const path = swebenchSpecTablePath(cacheRoot);
	if (!existsSync(path)) {
		return null;
	}
	const dump = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof parseSwebenchSpecDump>[0];
	return parseSwebenchSpecDump(dump);
}
