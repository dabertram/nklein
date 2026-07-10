/**
 * §13d DISTILL — fold a record-proxy capture directory (aimock fixture files) into simulator scenario TRACKS,
 * classified by request class + failure-catalog id, ready to merge into a scenario set or replay standalone.
 *
 * Usage:  npx tsx scripts/distill-capture.mts <captureDir> [--out <tracks.json>]
 *         Output: a ScenarioScript JSON ({name, seed, tracks}) with per-capture provenance.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { distillCampaign, entriesFromCaptureFile } from "../packages/llm-simulator/src/index.js";
import type { RecordedFixtureEntry } from "../packages/llm-simulator/src/index.js";

const captureDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!captureDir) {
	console.error("Usage: npx tsx scripts/distill-capture.mts <captureDir> [--out <tracks.json>]");
	process.exit(1);
}
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1] as string) : join(captureDir, "distilled-tracks.json");

const entries: RecordedFixtureEntry[] = [];
const walk = (dir: string): void => {
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, name.name);
		if (name.isDirectory()) {
			walk(path);
			continue;
		}
		if (!name.name.endsWith(".json") || name.name === "distilled-tracks.json") {
			continue;
		}
		try {
			entries.push(...entriesFromCaptureFile(JSON.parse(readFileSync(path, "utf8"))));
		} catch (error) {
			console.warn(`skipping unreadable capture file ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
};
walk(captureDir);

const tracks = distillCampaign(entries);
const byBucket = new Map<string, number>();
for (const track of tracks) {
	const bucket = track.id.split(":").slice(0, 2).join(":");
	byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
}
const script = { name: `distilled: ${captureDir.split("/").slice(-2).join("/")}`, seed: 1, tracks };
writeFileSync(outPath, `${JSON.stringify(script, null, "\t")}\n`);
console.log(`Distilled ${entries.length} capture(s) → ${tracks.length} track(s) → ${outPath}`);
for (const [bucket, count] of [...byBucket.entries()].sort()) {
	console.log(`  ${bucket}: ${count}`);
}
