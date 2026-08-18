/**
 * P0 write-loss probe (bed pair-3b finding, 2026-08-18): does a write_file with an ABSOLUTE workdir path
 * (`/workspaces/<segment>/…`) reach the capture patch like a relative write does? Real sandbox manager, real
 * container, no model — deterministic. PASS = both files in the patch (loss not reproducible at this layer);
 * FAIL = the absolute write is missing (loss point pinned here).
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentSandboxManager } from "../src/nklein-agent/nklein-agent-sandbox";
import { AGENT_SANDBOX_EXTRA_TOOL_RUNNER } from "../src/nklein-agent/nklein-agent-sandbox-extra-tools";
import { normalizeTaskIdForSandboxPath } from "../src/nklein-agent/nklein-agent-sandbox-task-path";

const execFileAsync = promisify(execFile);
const TASK_ID = "write-loss-probe-task";

const repo = await mkdtemp(join(tmpdir(), "write-loss-probe-"));
await writeFile(join(repo, "README.md"), "probe repo\n");
const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
await git("init", "--quiet", "--initial-branch=main");
await git("add", "-A");
await git("-c", "user.email=probe@local", "-c", "user.name=probe", "commit", "-qm", "init");

const manager = new AgentSandboxManager();
let exitCode = 1;
try {
	const placement = await manager.prepareWorkspace({ taskId: TASK_ID, projectRepoPath: repo, baseRef: "main" });
	const segment = normalizeTaskIdForSandboxPath(TASK_ID);
	process.stdout.write(`workdir: ${placement.workdir} (segment ${segment})\n`);

	const writeVia = async (label: string, path: string): Promise<void> => {
		const result = await manager.runTool(TASK_ID, AGENT_SANDBOX_EXTRA_TOOL_RUNNER, {
			toolName: "write_file",
			sessionId: TASK_ID,
			input: { path, content: `${label} content\n` },
		});
		process.stdout.write(`${label} write (${path}) → ${String(result).slice(0, 120).replaceAll("\n", " ")}\n`);
	};
	await writeVia("relative", "probe-rel.txt");
	await writeVia("absolute", `${placement.workdir}/probe-abs.txt`);

	const patch = await manager.captureWorkspacePatch(TASK_ID, { baseRef: "main" });
	const hasRel = patch.includes("probe-rel.txt");
	const hasAbs = patch.includes("probe-abs.txt");
	process.stdout.write(`patch bytes: ${patch.length} | rel in patch: ${hasRel} | abs in patch: ${hasAbs}\n`);
	if (hasRel && hasAbs) {
		process.stdout.write("WRITE-LOSS PROBE: NOT REPRODUCED at this layer (both writes captured)\n");
		exitCode = 0;
	} else {
		process.stdout.write(`WRITE-LOSS PROBE: REPRODUCED — missing ${hasRel ? "ABSOLUTE" : "RELATIVE"} write in the capture patch\n`);
		exitCode = 2;
	}
} finally {
	await manager.disposeWorkspace?.(TASK_ID).catch?.(() => undefined);
	await (manager as unknown as { stop?: () => Promise<void> }).stop?.().catch(() => undefined);
	await rm(repo, { recursive: true, force: true });
}
process.exit(exitCode);
