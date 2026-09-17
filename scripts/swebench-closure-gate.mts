/**
 * The SWE-bench environment gate, as a committed tool with a durable ledger.
 *
 *   tsx scripts/swebench-closure-gate.mts scan                 # group every cached instance into its closure
 *   tsx scripts/swebench-closure-gate.mts run [--parallel N]   # negative-control every closure not yet proven
 *   tsx scripts/swebench-closure-gate.mts status               # clean / dirty / unproven at the current grader
 *
 * WHY THIS EXISTS AS A FILE. The gate's unit is the CLOSURE, not the spec: a `(repo, version)` spec spans many base
 * commits, and two instances share a sealed environment only when their checkouts declare the same build
 * requirements, `setup_requires` and exact pins (`instanceBuildDeclarations`). A per-spec gate went 81/81 green
 * and the first scored instance walked straight into a closure it had never proven. The scanner and workers that
 * found the 96 closures lived in a session scratchpad, and on 2026-09-17 they vanished with it — mid-gate, with
 * six re-controls running and nothing recorded. Twice now the gate's state has lived in /tmp.
 *
 * WHAT "PROVEN" MEANS. A negative control grades the PRISTINE tree with only the test patch applied. Every
 * pass-to-pass test must pass by construction, so any failure — or any install refusal — is our environment's,
 * never a model's. A closure is clean when its control ran, nothing refused, and no pass-to-pass id failed.
 *
 * WHY A FINGERPRINT, NOT A DATE. A proof is only a proof of the grade path that produced it. Every ledger row
 * carries a hash of the grader's source; change the grader and every earlier proof reads as UNPROVEN without
 * anyone having to remember that it should. (The same thing happened by hand on 2026-09-16: an era cap added
 * after the closures were built silently invalidated all of them.)
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSwebenchEnv } from "../src/core/swebench-env-spec";
import {
	applyTestPatchToCopy,
	gradeSwebenchWorkspace,
	SWEBENCH_PREPARE_MARKER,
	instanceBuildDeclarations,
	swebenchWheelCacheKey,
} from "../src/core/swebench-grader";
import { materializeSwebenchInstance, readSwebenchCacheEntry, swebenchCacheRoot } from "../src/core/swebench-materialize";
import { loadSwebenchSpecTable } from "../src/core/swebench-spec-table";
import { SWEBENCH_TRANCHE } from "../src/core/swebench-tranche";

const repoRoot = process.cwd();
const cacheRoot = swebenchCacheRoot(repoRoot);
const GATE_DIR = process.env.SWEBENCH_GATE_DIR ?? join(homedir(), ".nklein", "swebench-gate");
const CLOSURES = join(GATE_DIR, "closures.json");
const LEDGER = join(GATE_DIR, "ledger.jsonl");

/** Every source file the grade path runs through. A change to any of them voids every proof made before it. */
const GRADER_SOURCES = [
	"src/core/swebench-grader.ts",
	"src/core/swebench-env-spec.ts",
	"src/core/swebench-instance.ts",
	"src/core/swebench-materialize.ts",
	"src/core/swebench-spec-table.ts",
	"src/core/swebench-tranche.ts",
];

interface Closure {
	readonly key: string;
	readonly specKey: string;
	readonly representative: string;
	readonly members: readonly string[];
}

interface LedgerRow {
	readonly closure: string;
	readonly instanceId: string;
	readonly fingerprint: string;
	readonly clean: boolean;
	readonly p2pTotal: number;
	readonly p2pFailed: number;
	readonly firstFailures: readonly string[];
	readonly refusal: string | null;
	readonly reason: string;
	/** The grader's own output tail, kept for a DIRTY row only: diagnosing it should not need a re-grade. */
	readonly outputTail?: string;
	readonly at: string;
}

function graderFingerprint(): string {
	const hash = createHash("sha256");
	for (const file of GRADER_SOURCES) {
		hash.update(file);
		hash.update(existsSync(join(repoRoot, file)) ? readFileSync(join(repoRoot, file)) : "(missing)");
	}
	return hash.digest("hex").slice(0, 16);
}

async function entryFor(instanceId: string) {
	const { instance } = await readSwebenchCacheEntry(cacheRoot, instanceId);
	return resolveSwebenchEnv({ instance, table: await loadSwebenchSpecTable(cacheRoot), overrides: SWEBENCH_TRANCHE });
}

async function commandScan(): Promise<Closure[]> {
	const ids = readdirSync(join(cacheRoot, "instances"))
		.filter((file) => file.endsWith(".json"))
		.map((file) => file.slice(0, -".json".length))
		.sort();
	const groups = new Map<string, { specKey: string; members: string[] }>();
	let unresolvable = 0;
	for (const instanceId of ids) {
		let specKey: string;
		try {
			specKey = swebenchWheelCacheKey(await entryFor(instanceId));
		} catch {
			unresolvable += 1;
			continue;
		}
		const declared = await instanceBuildDeclarations(cacheRoot, instanceId);
		const signature = createHash("sha256").update(JSON.stringify(declared)).digest("hex").slice(0, 12);
		const key = `${specKey}#${signature}`;
		const group = groups.get(key) ?? { specKey, members: [] };
		group.members.push(instanceId);
		groups.set(key, group);
	}
	const closures: Closure[] = [...groups.entries()]
		.map(([key, group]) => ({ key, specKey: group.specKey, representative: group.members[0] ?? "", members: group.members }))
		.sort((a, b) => a.key.localeCompare(b.key));
	await mkdir(GATE_DIR, { recursive: true });
	await writeFile(CLOSURES, `${JSON.stringify(closures, null, 1)}\n`);
	const specs = new Set(closures.map((closure) => closure.specKey)).size;
	process.stdout.write(
		`${ids.length} cached instances → ${closures.length} closures across ${specs} specs` +
			`${unresolvable > 0 ? ` (${unresolvable} unresolvable, not gated)` : ""}\nwritten ${CLOSURES}\n`,
	);
	return closures;
}

function readClosures(): Closure[] {
	if (!existsSync(CLOSURES)) {
		throw new Error(`no ${CLOSURES} — run \`scan\` first`);
	}
	return JSON.parse(readFileSync(CLOSURES, "utf8")) as Closure[];
}

/** The newest row per closure at this fingerprint — older fingerprints do not count. */
function currentProofs(fingerprint: string): Map<string, LedgerRow> {
	const latest = new Map<string, LedgerRow>();
	if (!existsSync(LEDGER)) {
		return latest;
	}
	for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const row = JSON.parse(line) as LedgerRow;
			if (row.fingerprint === fingerprint) {
				latest.set(row.closure, row);
			}
		} catch {
			// a torn last line from a killed run is not a proof of anything
		}
	}
	return latest;
}

async function controlOne(closure: Closure, fingerprint: string): Promise<LedgerRow> {
	const instanceId = closure.representative;
	const base = await mkdtemp(join(tmpdir(), "swebench-gate-"));
	const pristineDir = join(base, instanceId);
	try {
		const entry = await entryFor(instanceId);
		const { instance } = await readSwebenchCacheEntry(cacheRoot, instanceId);
		await materializeSwebenchInstance({ cacheRoot, instanceId, targetDir: pristineDir });
		const copyDir = join(base, "work");
		await cp(pristineDir, copyDir, { recursive: true });
		const applied = await applyTestPatchToCopy(copyDir, instance.testPatch);
		if (!applied.applied) {
			return row(closure, fingerprint, { clean: false, p2pTotal: instance.passToPass.length, p2pFailed: 0, firstFailures: [], refusal: `test patch did not apply: ${applied.reason}`, reason: "test patch did not apply" });
		}
		const verdict = await gradeSwebenchWorkspace({ entry, instance, workspaceCopyDir: copyDir, cacheRoot });
		const clean = verdict.environmentRefusal === null && verdict.passToPassFailed.length === 0;
		return row(closure, fingerprint, {
			clean,
			p2pTotal: instance.passToPass.length,
			p2pFailed: verdict.passToPassFailed.length,
			firstFailures: verdict.passToPassFailed.slice(0, 8),
			refusal: verdict.environmentRefusal,
			reason: verdict.reason,
			...(clean ? {} : { outputTail: verdict.graderStdoutTail }),
		});
	} catch (error) {
		return row(closure, fingerprint, { clean: false, p2pTotal: 0, p2pFailed: 0, firstFailures: [], refusal: `control crashed: ${error instanceof Error ? error.message.slice(0, 400) : String(error)}`, reason: "control crashed" });
	} finally {
		await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
	}
}

function row(closure: Closure, fingerprint: string, facts: Omit<LedgerRow, "closure" | "instanceId" | "fingerprint" | "at">): LedgerRow {
	return { closure: closure.key, instanceId: closure.representative, fingerprint, ...facts, at: new Date().toISOString() };
}

async function commandRun(parallel: number): Promise<void> {
	const fingerprint = graderFingerprint();
	const closures = readClosures();
	const proven = currentProofs(fingerprint);
	const queue = closures.filter((closure) => !proven.get(closure.key)?.clean);
	process.stdout.write(`grader ${fingerprint}: ${closures.length - queue.length} already clean, ${queue.length} to control (parallel ${parallel})\n`);
	let next = 0;
	let done = 0;
	const worker = async () => {
		for (;;) {
			const closure = queue[next++];
			if (!closure) {
				return;
			}
			const result = await controlOne(closure, fingerprint);
			// Appended as each control finishes: a killed run keeps every proof it already made.
			await appendFile(LEDGER, `${JSON.stringify(result)}\n`);
			done += 1;
			const detail = result.refusal ? `REFUSED ${result.refusal.slice(0, 120)}` : `${result.p2pTotal - result.p2pFailed}/${result.p2pTotal} p2p`;
			process.stdout.write(`[${done}/${queue.length}] ${result.clean ? "CLEAN" : "DIRTY"} ${closure.key} (${closure.representative}) ${detail}\n`);
		}
	};
	await Promise.all(Array.from({ length: parallel }, worker));
	await recoverUnpreparedClosures(fingerprint);
	commandStatus();
}

/**
 * A closure its spec's `prepare` never saw. The wheel cache is shared per spec and `prepare` probes ONE checkout,
 * then marks the whole spec complete — the per-spec mistake the gate itself already fixed, one layer down. When a
 * sibling closure's checkout declares a dependency that representative did not, its sealed install cannot find
 * it: pytest 5.4's `iniconfig`, pytest 7.2's `exceptiongroup` (live 2026-09-17). The grade rightly REFUSES; this
 * turns that refusal into the missing step.
 *
 * It runs AFTER the parallel pass on purpose: a prepare writes into the spec's shared cache, and a control of a
 * sibling closure reading that cache mid-download would be measuring a moving target. Wheels only accumulate, and
 * every closure of the spec is re-proven by the gate anyway, so a probe that shifted what a sibling resolves is
 * caught rather than trusted.
 */
async function recoverUnpreparedClosures(fingerprint: string): Promise<void> {
	const proofs = currentProofs(fingerprint);
	const unprepared = readClosures().filter((closure) => {
		const proof = proofs.get(closure.key);
		return proof && !proof.clean && proof.refusal !== null && /No matching distribution found for/u.test(proof.outputTail ?? "");
	});
	for (const closure of unprepared) {
		const missing = [...(proofs.get(closure.key)?.outputTail ?? "").matchAll(/No matching distribution found for (\S+)/gu)].map((m) => m[1]);
		process.stdout.write(`UNPREPARED ${closure.key}: its checkout needs ${missing.join(", ")} — ⚠ EGRESS: preparing from ${closure.representative}\n`);
		// The spec marker says "complete", which is exactly the claim this closure just disproved.
		await rm(join(cacheRoot, "wheels", closure.specKey, SWEBENCH_PREPARE_MARKER), { force: true });
		const prepared = await runPrepare(closure.representative, closure.specKey);
		if (!prepared) {
			process.stdout.write(`  prepare FAILED for ${closure.representative} — the closure stays dirty; see ${join(GATE_DIR, "prepare.log")}\n`);
			continue;
		}
		const result = await controlOne(closure, fingerprint);
		await appendFile(LEDGER, `${JSON.stringify(result)}\n`);
		const detail = result.refusal ? `REFUSED ${result.refusal.slice(0, 120)}` : `${result.p2pTotal - result.p2pFailed}/${result.p2pTotal} p2p`;
		process.stdout.write(`[recovered] ${result.clean ? "CLEAN" : "DIRTY"} ${closure.key} (${closure.representative}) ${detail}\n`);
	}
}

/** Proven only by the marker coming back: `prepare` writes it after the sealed offline install succeeded. */
function runPrepare(instanceId: string, specKey: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn("npx", ["tsx", "scripts/swebench-grade.mts", "prepare", instanceId], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
		const log = join(GATE_DIR, "prepare.log");
		const sink = (chunk: Buffer) => void appendFile(log, chunk);
		child.stdout.on("data", sink);
		child.stderr.on("data", sink);
		child.on("close", (code) => resolve(code === 0 && existsSync(join(cacheRoot, "wheels", specKey, SWEBENCH_PREPARE_MARKER))));
		child.on("error", () => resolve(false));
	});
}

function commandStatus(): void {
	const fingerprint = graderFingerprint();
	const closures = readClosures();
	const proven = currentProofs(fingerprint);
	const clean = closures.filter((closure) => proven.get(closure.key)?.clean);
	const dirty = closures.filter((closure) => proven.has(closure.key) && !proven.get(closure.key)?.clean);
	const unproven = closures.filter((closure) => !proven.has(closure.key));
	process.stdout.write(`grader ${fingerprint}: ${clean.length} clean, ${dirty.length} dirty, ${unproven.length} unproven — of ${closures.length} closures\n`);
	for (const closure of dirty) {
		const result = proven.get(closure.key);
		process.stdout.write(
			`  DIRTY ${closure.key} (${closure.representative}, ${closure.members.length} instance(s)): ${result?.refusal ?? `${result?.p2pFailed}/${result?.p2pTotal} p2p failed — ${result?.firstFailures.slice(0, 3).join(", ")}`}\n`,
		);
	}
	process.exitCode = clean.length === closures.length ? 0 : 1;
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "scan") {
	await commandScan();
} else if (mode === "run") {
	const at = args.indexOf("--parallel");
	await commandRun(Math.max(1, Number(at >= 0 ? args[at + 1] : 3) || 3));
} else if (mode === "status") {
	commandStatus();
} else {
	process.stderr.write("usage: swebench-closure-gate.mts scan | run [--parallel N] | status\n");
	process.exitCode = 2;
}
