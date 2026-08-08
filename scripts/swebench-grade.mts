/**
 * N8 — sealed-grader CLI.
 *
 *   tsx scripts/swebench-grade.mts prepare [<id>...]   # ⚠ EGRESS once per instance: wheel cache via docker
 *   tsx scripts/swebench-grade.mts grade <id> <dir>    # sealed (--network none): grade a delivered workspace
 *   tsx scripts/swebench-grade.mts control <id>        # negative control: grade the UNFIXED workspace
 *
 * `grade`/`control` copy the workspace, apply the instance's own test_patch host-side, and judge inside a
 * stock python:3.9-slim container with the network namespace OFF (wheels come from the prepared cache only).
 */

import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyTestPatchToCopy,
	gradeSwebenchWorkspace,
	prepareSwebenchWheels,
} from "../src/core/swebench-grader";
import { listGradedTestFiles } from "../src/core/swebench-instance";
import { materializeSwebenchInstance, readSwebenchCacheEntry, swebenchCacheRoot } from "../src/core/swebench-materialize";
import { SWEBENCH_TRANCHE } from "../src/core/swebench-tranche";

const cacheRoot = swebenchCacheRoot(process.cwd());

function trancheEntry(instanceId: string) {
	const entry = SWEBENCH_TRANCHE.find((candidate) => candidate.instanceId === instanceId);
	if (!entry) {
		throw new Error(`${instanceId} is not in SWEBENCH_TRANCHE.`);
	}
	return entry;
}

async function commandPrepare(ids: readonly string[]): Promise<void> {
	const targets = ids.length > 0 ? ids : SWEBENCH_TRANCHE.map((entry) => entry.instanceId);
	for (const instanceId of targets) {
		const entry = trancheEntry(instanceId);
		const sourceDir = join(await mkdtemp(join(tmpdir(), "swebench-prep-")), instanceId);
		process.stdout.write(`⚠ EGRESS (once): resolving ${instanceId}'s wheel cache inside the grader…\n`);
		await materializeSwebenchInstance({ cacheRoot, instanceId, targetDir: sourceDir });
		try {
			await prepareSwebenchWheels({ entry, sourceDir, cacheRoot });
			process.stdout.write(`  wheels cached for ${instanceId}\n`);
		} finally {
			await rm(join(sourceDir, ".."), { recursive: true, force: true });
		}
	}
}

async function gradeDir(instanceId: string, workspaceDir: string, label: string): Promise<number> {
	const entry = trancheEntry(instanceId);
	const { instance } = await readSwebenchCacheEntry(cacheRoot, instanceId);
	const copyDir = join(await mkdtemp(join(tmpdir(), "swebench-grade-")), "work");
	await cp(workspaceDir, copyDir, { recursive: true });
	try {
		const applied = await applyTestPatchToCopy(copyDir, instance.testPatch);
		if (!applied.applied) {
			// Not a crash and NOT a pass: the run is ungradable because the graded tests were changed. Name the
			// files the instance grades by, so the operator can diff them directly instead of re-deriving the set
			// from a git error — the whole point of the verdict is that it is actionable.
			const graded = listGradedTestFiles(instance.testPatch);
			process.stdout.write(
				`${label} ${instanceId}: UNGRADABLE (${applied.reason}) — the instance's own tests no longer apply, which means the agent edited the files it is graded by.\n` +
					`  graded files (inspect these in ${workspaceDir}): ${graded.join(", ")}\n` +
					`  git: ${applied.detail.split("\n")[0] ?? ""}\n`,
			);
			return 1;
		}
		const verdict = await gradeSwebenchWorkspace({ entry, instance, workspaceCopyDir: copyDir, cacheRoot });
		process.stdout.write(`${label} ${instanceId}: ${verdict.reason}\n`);
		return verdict.resolved ? 0 : 1;
	} finally {
		await rm(join(copyDir, ".."), { recursive: true, force: true });
	}
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "prepare") {
	await commandPrepare(args);
} else if (mode === "grade" && args[0] && args[1]) {
	process.exitCode = await gradeDir(args[0], args[1], "grade");
} else if (mode === "control" && args[0]) {
	// Negative control: the PRISTINE (unfixed) workspace must grade unresolved with every F2P failing.
	const instanceId = args[0];
	const pristineDir = join(await mkdtemp(join(tmpdir(), "swebench-ctrl-")), instanceId);
	await materializeSwebenchInstance({ cacheRoot, instanceId, targetDir: pristineDir });
	try {
		const rc = await gradeDir(instanceId, pristineDir, "control(unfixed)");
		process.exitCode = rc === 1 ? 0 : 1; // unresolved is the EXPECTED control outcome
	} finally {
		await rm(join(pristineDir, ".."), { recursive: true, force: true });
	}
} else {
	process.stderr.write("usage: swebench-grade.mts prepare [<id>...] | grade <id> <workspaceDir> | control <id>\n");
	process.exit(64);
}
