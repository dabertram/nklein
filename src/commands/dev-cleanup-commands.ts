// §5.U cohesive extraction (2026-07-07): the `nklein dev cleanup-report` CLI command group, lifted out of the large
// `commands/dev.ts`. It scans for scaffolded dev-test workspaces + `nklein`-prefixed Docker sandbox volumes and reports
// what is reclaimable. Thin CLI wrapper over the pure `core/dev-test-cleanup` logic; couples imports-only.
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { summarizeDevTestCleanup } from "../core/dev-test-cleanup";
import { NKLEIN_DEV_TEST_PROJECT_MARKER_PATH } from "../nklein-agent/nklein-dev-test-project";
import { type DevTestCleanupCandidate, discoverDevTestCleanupEntries } from "../nklein-agent/nklein-dev-test-runner";
import { resolveProjectInputPath } from "../projects/project-path";

const execFileAsync = promisify(execFile);

export interface DevCleanupReportOptions {
	scanDir?: string;
	activeWorkspacePath?: string;
	json?: boolean;
	cwd?: string;
	write?: (text: string) => void;
}

/** Directory size in bytes via `du -sk`; best-effort, returns 0 when `du` is unavailable. */
async function directorySizeBytes(path: string): Promise<number> {
	try {
		const { stdout } = await execFileAsync("du", ["-sk", path]);
		const kib = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "0", 10);
		return Number.isFinite(kib) ? kib * 1024 : 0;
	} catch {
		return 0;
	}
}

/** Scan a parent directory for scaffolded dev-test project workspaces (identified by their marker file). */
async function discoverDevTestWorkspacesInDir(scanDir: string): Promise<DevTestCleanupCandidate[]> {
	let entries: string[];
	try {
		entries = await readdir(scanDir);
	} catch {
		return [];
	}
	const candidates: DevTestCleanupCandidate[] = [];
	for (const entry of entries) {
		const workspacePath = join(scanDir, entry);
		try {
			const markerStat = await stat(join(workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH));
			if (!markerStat.isFile()) {
				continue;
			}
		} catch {
			continue;
		}
		candidates.push({
			path: workspacePath,
			kind: "dev_test_workspace",
			sizeBytes: await directorySizeBytes(workspacePath),
		});
	}
	return candidates;
}

/** Docker sandbox named volumes created for agent isolation (`nklein`-prefixed); size is best-effort. */
async function discoverSandboxVolumes(): Promise<DevTestCleanupCandidate[]> {
	try {
		const { stdout } = await execFileAsync("docker", ["volume", "ls", "--format", "{{.Name}}"]);
		return stdout
			.split("\n")
			.map((name) => name.trim())
			.filter((name) => name.startsWith("nklein"))
			.map((name) => ({ path: name, kind: "sandbox_volume" as const, sizeBytes: 0 }));
	} catch {
		return [];
	}
}

export async function runDevCleanupReportCommand(options: DevCleanupReportOptions = {}): Promise<void> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const scanDir = options.scanDir ?? tmpdir();
	const activeWorkspacePath = options.activeWorkspacePath
		? resolveProjectInputPath(options.activeWorkspacePath, options.cwd ?? process.cwd())
		: null;

	const entries = await discoverDevTestCleanupEntries({
		listDevTestWorkspaces: () => discoverDevTestWorkspacesInDir(scanDir),
		listSandboxVolumes: discoverSandboxVolumes,
		activeWorkspacePath,
	});
	const report = summarizeDevTestCleanup(entries);

	if (options.json) {
		write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	write(`Scanned dev-test workspaces under: ${scanDir}\n`);
	write(`${report.summary}\n`);
	for (const entry of report.reclaimable) {
		write(`  reclaimable [${entry.kind}] ${entry.path}\n`);
	}
}
