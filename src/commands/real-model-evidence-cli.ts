import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	distillCampaign,
	entriesFromPersistedTranscript,
	type RecordedFixtureEntry,
} from "../../packages/llm-simulator/src/index.js";
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
	/**
	 * Epoch ms of this run's start. A DURABLE run home (the depth-volume campaign's accrual home) keeps every
	 * prior run's session transcripts, so an unfiltered collect bundles other runs' sessions into this run's
	 * evidence — the 2026-08-19 campaign's round-2 bundles carried round-1 task ids. Null ⇒ collect everything
	 * (the isolated-home default, unchanged).
	 */
	sinceMs: number | null;
}

interface EvidenceFileError {
	file: string;
	error: string;
}

interface CollectedTranscript {
	file: string;
	sessionId: string;
	messageCount: number;
	executions: RealModelToolExecutionEvidence[];
	aimockEntries: RecordedFixtureEntry[];
}

interface ReplaySelection {
	key: string;
	selected: CollectedTranscript;
	superseded: CollectedTranscript[];
}

function parseArgs(args: readonly string[]): CliOptions {
	let homeDir: string | null = null;
	let outputDir: string | null = null;
	let runtimeLogPath: string | null = null;
	let sinceMs: number | null = null;
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
			case "--since": {
				const parsed = Number(value);
				// A malformed --since must not silently widen the bundle back to "everything": fail loudly.
				if (!Number.isFinite(parsed) || parsed < 0) {
					throw new Error(`--since expects epoch milliseconds, received: ${String(value)}`);
				}
				sinceMs = parsed;
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${args[index]}`);
		}
	}
	if (!homeDir || !outputDir) {
		throw new Error(
			"Usage: real-model-evidence-cli --home <run-home> --out <evidence-dir> [--runtime-log <path>] [--since <epoch-ms>]",
		);
	}
	return {
		homeDir: resolve(homeDir),
		outputDir: resolve(outputDir),
		runtimeLogPath: runtimeLogPath ? resolve(runtimeLogPath) : null,
		sinceMs,
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

function replayKey(transcript: CollectedTranscript): string | null {
	const firstTrack = distillCampaign(transcript.aimockEntries)[0];
	if (!firstTrack?.userMessageIncludes) {
		return null;
	}
	return `${firstTrack.requestClass}\u0000${firstTrack.userMessageIncludes.toLowerCase()}`;
}

function preferReplayTranscript(left: CollectedTranscript, right: CollectedTranscript): CollectedTranscript {
	if (left.messageCount !== right.messageCount) {
		return left.messageCount > right.messageCount ? left : right;
	}
	if (left.executions.length !== right.executions.length) {
		return left.executions.length > right.executions.length ? left : right;
	}
	return left.sessionId.localeCompare(right.sessionId) >= 0 ? left : right;
}

/**
 * A runtime retry starts a fresh SDK session with the same card prompt and assistant count. Both captures are valid
 * evidence, but compiling both into one aimock script creates indistinguishable predicates; the first silently
 * shadows the rest. Keep every raw fixture, while selecting one deterministic, most-complete transcript per compiled
 * match key for the executable replay. The manifest makes every supersession explicit.
 */
function selectReplayTranscripts(transcripts: readonly CollectedTranscript[]): ReplaySelection[] {
	const selections = new Map<string, ReplaySelection>();
	for (const transcript of transcripts) {
		const key = replayKey(transcript);
		if (!key) {
			continue;
		}
		const current = selections.get(key);
		if (!current) {
			selections.set(key, { key, selected: transcript, superseded: [] });
			continue;
		}
		const preferred = preferReplayTranscript(current.selected, transcript);
		if (preferred === current.selected) {
			current.superseded.push(transcript);
		} else {
			current.superseded.push(current.selected);
			current.selected = transcript;
		}
	}
	return [...selections.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export async function collectRealModelRunEvidence(options: CliOptions): Promise<Record<string, unknown>> {
	await mkdir(options.outputDir, { recursive: true });
	const sessionOutputDir = join(options.outputDir, "sessions");
	const boardOutputDir = join(options.outputDir, "boards");
	await Promise.all([mkdir(sessionOutputDir, { recursive: true }), mkdir(boardOutputDir, { recursive: true })]);

	const errors: EvidenceFileError[] = [];
	const transcriptFiles = [
		...(await findFiles(join(options.homeDir, ".nklein", "data", "sessions"), (path) =>
			path.endsWith(".messages.json"),
		)),
		...(await findFiles(join(options.homeDir, ".nklein", "evidence-session-snapshots"), (path) =>
			path.endsWith(".messages.json"),
		)),
	];
	// Auxiliary sessions are intentionally cleared after their bounded turn. The controller snapshots them while live;
	// merge those snapshots with still-live transcripts by session id and retain the most complete copy of each session.
	const transcriptBySessionId = new Map<string, CollectedTranscript>();
	for (const file of transcriptFiles) {
		try {
			// Durable-home guard: skip transcripts last written BEFORE this run began. mtime is the right clock
			// here — a transcript that this run touched has been rewritten by it; one it never touched has not.
			if (options.sinceMs !== null) {
				const lastWrittenMs = await stat(file)
					.then((stats) => stats.mtimeMs)
					.catch(() => null);
				// An unreadable mtime must not silently drop real evidence — keep the file and let the bundle be
				// wider than necessary rather than quietly narrower than the truth.
				if (lastWrittenMs !== null && lastWrittenMs < options.sinceMs) {
					continue;
				}
			}
			const body = await readFile(file, "utf8");
			const document: unknown = JSON.parse(body);
			const executions = extractRealModelToolEvidence(document);
			const record = typeof document === "object" && document !== null ? (document as Record<string, unknown>) : {};
			const sessionId =
				(typeof record.sessionId === "string" && record.sessionId.trim()) ||
				executions[0]?.sessionId ||
				basename(dirname(file));
			const messageCount = Array.isArray(record.messages) ? record.messages.length : 0;
			const aimockEntries = entriesFromPersistedTranscript(document);
			const previous = transcriptBySessionId.get(sessionId);
			if (
				!previous ||
				executions.length > previous.executions.length ||
				(executions.length === previous.executions.length && messageCount > previous.messageCount)
			) {
				transcriptBySessionId.set(sessionId, { file, sessionId, messageCount, executions, aimockEntries });
			}
		} catch (error) {
			errors.push({ file, error: error instanceof Error ? error.message : String(error) });
		}
	}
	const transcripts = [...transcriptBySessionId.values()];
	for (const transcript of transcripts) {
		await copyFile(transcript.file, join(sessionOutputDir, `${safeName(transcript.sessionId)}.messages.json`));
	}
	const sessionExecutions = transcripts.map((transcript) => transcript.executions);
	const aimockEntries = transcripts.flatMap((transcript) => transcript.aimockEntries);
	const replaySelections = selectReplayTranscripts(transcripts);
	const replayEntries = replaySelections.flatMap((selection) => selection.selected.aimockEntries);
	const aimockReplay = {
		name: `real-model-evidence:${basename(options.outputDir)}`,
		seed: 1,
		tracks: distillCampaign(replayEntries),
	};
	await Promise.all([
		writeFile(
			join(options.outputDir, "aimock-recorded-fixtures.json"),
			`${JSON.stringify({ fixtures: aimockEntries }, null, 2)}\n`,
			"utf8",
		),
		writeFile(join(options.outputDir, "aimock-replay.json"), `${JSON.stringify(aimockReplay, null, 2)}\n`, "utf8"),
		writeFile(
			join(options.outputDir, "aimock-replay-manifest.json"),
			`${JSON.stringify(
				replaySelections.map((selection) => ({
					requestClass: selection.key.split("\u0000")[0],
					needle: selection.key.split("\u0000")[1],
					selectedSessionId: selection.selected.sessionId,
					selectedMessageCount: selection.selected.messageCount,
					supersededSessionIds: selection.superseded.map((transcript) => transcript.sessionId).sort(),
				})),
				null,
				2,
			)}\n`,
			"utf8",
		),
	]);

	const executions = sessionExecutions.flat().sort((left, right) => (left.toolUseAt ?? 0) - (right.toolUseAt ?? 0));
	await Promise.all([
		writeJsonLines(join(options.outputDir, "tool-executions.jsonl"), executions),
		writeJsonLines(
			join(options.outputDir, "tool-errors.jsonl"),
			executions.filter((execution) => execution.effectiveError === true),
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
		aimockRecordedFixtures: aimockEntries.length,
		aimockReplayTracks: aimockReplay.tracks.length,
		aimockReplaySessions: replaySelections.length,
		aimockSupersededSessions: replaySelections.reduce((total, selection) => total + selection.superseded.length, 0),
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
