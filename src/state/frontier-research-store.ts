import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type FrontierReport, frontierReportSchema } from "../core/frontier-research";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Frontier-radar report store — append-only JSONL, one row per completed research run, mirroring the other
 * thin `jsonl-store` wrappers. Reports accrue (the radar's history IS part of the fun — "what did the
 * frontier look like last month?"), and the latest row drives the always-visible status icon.
 */

const DEFAULT_PATH = join(resolveNkleinRuntimeHomePath(homedir()), "frontier-research", "reports.jsonl");

function resolvePath(rootDir?: string): string {
	return rootDir ? join(rootDir, "reports.jsonl") : DEFAULT_PATH;
}

export async function appendFrontierReport(report: FrontierReport, rootDir?: string): Promise<void> {
	const path = resolvePath(rootDir);
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(report)}\n`, "utf8");
}

export async function readLatestFrontierReport(rootDir?: string): Promise<FrontierReport | null> {
	const path = resolvePath(rootDir);
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch {
		return null;
	}
	const reports = parseValidatedJsonl(content, frontierReportSchema, "frontier-research-store");
	return reports.length > 0 ? (reports[reports.length - 1] ?? null) : null;
}
