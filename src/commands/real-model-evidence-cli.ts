import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	extractRealModelRuntimeSignals,
	extractRealModelToolEvidence,
	isCardTransitionLedgerEvent,
	type RealModelToolExecutionEvidence,
	summarizeRealModelToolEvidence,
} from "../core/real-model-run-evidence.js";

export interface CliOptions {
	homeDir: string;
	outputDir: string;
	runtimeLogPath: string | null;
}

interface EvidenceFileError {
	file: string;
	error: string;
}

function parseArgs(args: readonly string[]): CliOptions {
	let homeDir: string | null = null;
	let outputDir: string | null = null;
	let runtimeLogPath: string | null = null;
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index + 1];
		switch (args[index]) {
			case "--home":
				homeDir = value ?? null;
				index += 1;
				break;
			case "--out":
				outputDir = value ?? null;
				index += 1;
				break;
			case "--runtime-log":
				runtimeLogPath = value ?? null;
				index += 1;
				break;
			default:
				throw new Error(`Unknown argument: ${args[index]}`);
		}
	}
	if (!homeDir || !outputDir) {
		throw new Error("Usage: real-model-evidence-cli --home <run-home> --out <evidence-dir> [--runtime-log <path>]");
	}
	return {
		homeDir: resolve(homeDir),
		outputDir: resolve(outputDir),
		runtimeLogPath: runtimeLogPath ? resolve(runtimeLogPath) : null,
	};
}

async function findFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			if (entry.isDirectory()) {
				return findFiles(path, predicate);
			}
			return entry.isFile() && predicate(path) ? [path] : [];
		}),
	);
	return nested.flat().sort();
}

function safeName(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/gu, "_");
}

async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
	const body = values.length === 0 ? "" : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
	await writeFile(path, body, "utf8");
}

function readJsonLines(body: string, file: string, errors: EvidenceFileError[]): Record<string, unknown>[] {
	const records: Record<string, unknown>[] = [];
	for (const [index, line] of body.split(/\r?\n/u).entries()) {
		if (!line.trim()) {
			continue;
		}
		try {
			const value: unknown = JSON.parse(line);
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				records.push({ ...(value as Record<string, unknown>), sourceFile: basename(file) });
			} else {
				errors.push({ file, error: `line ${index + 1}: expected a JSON object` });
			}
		} catch (error) {
			errors.push({ file, error: `line ${index + 1}: ${error instanceof Error ? error.message : String(error)}` });
		}
	}
	return records;
}

export async function collectRealModelRunEvidence(options: CliOptions): Promise<Record<string, unknown>> {
	await mkdir(options.outputDir, { recursive: true });
	const sessionOutputDir = join(options.outputDir, "sessions");
	const boardOutputDir = join(options.outputDir, "boards");
	await Promise.all([mkdir(sessionOutputDir, { recursive: true }), mkdir(boardOutputDir, { recursive: true })]);

	const errors: EvidenceFileError[] = [];
	const transcriptFiles = await findFiles(join(options.homeDir, ".nklein", "data", "sessions"), (path) =>
		path.endsWith(".messages.json"),
	);
	const sessionExecutions: RealModelToolExecutionEvidence[][] = [];
	for (const file of transcriptFiles) {
		try {
			const body = await readFile(file, "utf8");
			const document: unknown = JSON.parse(body);
			const executions = extractRealModelToolEvidence(document);
			sessionExecutions.push(executions);
			const sessionId = executions[0]?.sessionId ?? basename(dirname(file));
			await copyFile(file, join(sessionOutputDir, `${safeName(sessionId)}.messages.json`));
		} catch (error) {
			errors.push({ file, error: error instanceof Error ? error.message : String(error) });
		}
	}

	const executions = sessionExecutions.flat().sort((left, right) => (left.toolUseAt ?? 0) - (right.toolUseAt ?? 0));
	await Promise.all([
		writeJsonLines(join(options.outputDir, "tool-executions.jsonl"), executions),
		writeJsonLines(
			join(options.outputDir, "tool-errors.jsonl"),
			executions.filter((execution) => execution.isError === true),
		),
		writeJsonLines(
			join(options.outputDir, "pending-tool-uses.jsonl"),
			executions.filter((execution) => execution.status === "pending"),
		),
	]);

	const ledgerFiles = await findFiles(join(options.homeDir, ".nklein", "nklein", "agent-attempt-ledger"), (path) =>
		path.endsWith(".jsonl"),
	);
	const ledgerEvents = (
		await Promise.all(ledgerFiles.map(async (file) => readJsonLines(await readFile(file, "utf8"), file, errors)))
	)
		.flat()
		.sort((left, right) => Number(left.recordedAt ?? 0) - Number(right.recordedAt ?? 0));
	const transitions = ledgerEvents.filter(isCardTransitionLedgerEvent);
	await Promise.all([
		writeJsonLines(join(options.outputDir, "agent-ledger.jsonl"), ledgerEvents),
		writeJsonLines(join(options.outputDir, "card-transitions.jsonl"), transitions),
	]);

	const workspaceRoot = join(options.homeDir, ".nklein", "nklein", "workspaces");
	const boardFiles = await findFiles(workspaceRoot, (path) => basename(path) === "board.json");
	for (const file of boardFiles) {
		const workspaceName = safeName(relative(workspaceRoot, dirname(file)) || "workspace");
		await copyFile(file, join(boardOutputDir, `${workspaceName}.board.json`));
	}

	let runtimeSignalCount = 0;
	if (options.runtimeLogPath) {
		try {
			const signals = extractRealModelRuntimeSignals(await readFile(options.runtimeLogPath, "utf8"));
			runtimeSignalCount = signals.length;
			await writeJsonLines(join(options.outputDir, "runtime-signals.jsonl"), signals);
		} catch (error) {
			errors.push({
				file: options.runtimeLogPath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const summary = {
		...summarizeRealModelToolEvidence(sessionExecutions),
		transitions: transitions.length,
		boards: boardFiles.length,
		ledgerEvents: ledgerEvents.length,
		runtimeSignals: runtimeSignalCount,
		collectionErrors: errors,
	};
	await writeFile(join(options.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	return summary;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	const options = parseArgs(process.argv.slice(2));
	const summary = await collectRealModelRunEvidence(options);
	process.stdout.write(`${JSON.stringify(summary)}\n`);
	if (Array.isArray(summary.collectionErrors) && summary.collectionErrors.length > 0) {
		process.exitCode = 1;
	}
}
