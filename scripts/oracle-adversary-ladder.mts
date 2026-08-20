/**
 * P20.1/P20.3 — the ORACLE ADVERSARY LADDER.
 *
 * The null-agent gate asks one question: does an agent that does NOTHING score above zero? That is the
 * weakest possible adversary, and passing it only proves the oracle is not trivially forgeable. Between
 * "did nothing" and "did the work" sit the forgeries that actually happen in practice, each of which the
 * null agent cannot detect:
 *
 *   L0 null       — empty workspace.                       Expect 0. (the existing gate)
 *   L1 scaffold   — prescribed files + exports exist, no behaviour (throw).  Expect 0.
 *   L2 refuse-all — every predicate returns the SAFE answer ("not allowed"). Expect 0.
 *   L3 allow-all  — every predicate returns the PERMISSIVE answer.           Expect 0.
 *   L4 shape-only — plausible objects with the spec's field names, no logic. Expect 0.
 *
 * L2 and L3 are the pair that matters most: a probe that only tests refusals is passed by an always-refuse
 * stub, and a probe that only tests the happy path is passed by an always-allow stub. Running BOTH is what
 * proves a probe pins its predicate in both directions rather than agreeing with a constant.
 *
 * A rung scoring above zero does NOT mean the agent cheated — it means the ORACLE would accept that forgery,
 * so every score it has produced is worth less than it appears. Usage:
 *   npx tsx scripts/oracle-adversary-ladder.mts <project-id>
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { listHeldOutProbes, runHeldOutOracle } from "../src/core/held-out-oracle-runner";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const projectId = process.argv[2] ?? "02_construction_jobsite_safety_compliance";
const probeDir = join(repoRoot, "test/protected/oracle", projectId);

/**
 * The spec-PRESCRIBED surface, DERIVED FROM THE PROBES rather than restated here. A hand-maintained list
 * would drift from the probes it is supposed to mirror, and a forgery aimed at the wrong surface proves
 * nothing — the adversary has to satisfy exactly what the oracle imports and calls.
 */
async function deriveSurface(files: readonly string[]): Promise<{ path: string; exports: string[] }[]> {
	const byPath = new Map<string, Set<string>>();
	for (const file of files) {
		const source = await readFile(file, "utf8");
		// `const xModule = await import(pathToFileURL(join(workspace, "<path>")).href)` → alias ↔ path
		const aliasByPath = new Map<string, string>();
		for (const m of source.matchAll(
			/const\s+(\w+)\s*=\s*await\s+import\(pathToFileURL\(join\(workspace,\s*"([^"]+)"\)/g,
		)) {
			aliasByPath.set(m[1] as string, m[2] as string);
			if (!byPath.has(m[2] as string)) byPath.set(m[2] as string, new Set());
		}
		for (const [alias, path] of aliasByPath) {
			for (const call of source.matchAll(new RegExp(`\\b${alias}\\.(\\w+)\\s*\\(`, "g"))) {
				byPath.get(path)?.add(call[1] as string);
			}
		}
		// Second binding style (project 36): a CANDIDATES path list plus `exported<T>("name")` lookups, where
		// ANY candidate module may supply a name. A forgery only has to satisfy the FIRST candidate, so that is
		// where the ladder writes — if the oracle accepts it there, it would accept it anywhere in the list.
		const candidateBlock = source.match(/const CANDIDATES\s*=\s*\[([^\]]+)\]/);
		if (candidateBlock) {
			const first = [...(candidateBlock[1] as string).matchAll(/"([^"]+)"/g)][0]?.[1];
			// The type argument itself contains `>` (e.g. `exported<(t: Any) => number>("trustRank")`), so a
			// `[^>]*` scan stops at the arrow and finds nothing. Non-greedy to the CALL parenthesis instead.
			const names = [...source.matchAll(/exported\s*<[\s\S]*?>\s*\(\s*"(\w+)"\s*\)/g)].map((m) => m[1] as string);
			if (first && names.length > 0) {
				const set = byPath.get(first) ?? new Set<string>();
				for (const name of names) set.add(name);
				byPath.set(first, set);
			}
		}
	}
	return [...byPath.entries()].map(([path, exports]) => ({ path, exports: [...exports] }));
}

type Rung = "null" | "scaffold" | "refuse-all" | "allow-all" | "shape-only";

function body(rung: Rung, name: string): string {
	switch (rung) {
		case "scaffold":
			// Present but inert: the shape a "created the files" agent leaves behind.
			return `export function ${name}(..._args: unknown[]): never { throw new Error("not implemented"); }`;
		case "refuse-all":
			return `export function ${name}(..._args: unknown[]): unknown { return { status: "Invalid", allowed: false, valid: false, recordable: false, conflicts: [], reasons: ["refused"], entries: [] }; }`;
		case "allow-all":
			return `export function ${name}(..._args: unknown[]): unknown { return { status: "Valid", allowed: true, valid: true, recordable: true, conflicts: [], reasons: [], entries: [] }; }`;
		case "shape-only":
			// Plausible field names lifted from the spec's vocabulary, with no relationship to the inputs.
			return `export function ${name}(..._args: unknown[]): unknown { return { status: "Valid", allowed: true, citations: [], reasons: [], conflicts: [], classification: "first-aid", recordable: false, entries: [], rows: [], applied: true, accepted: true, version: 1 }; }`;
		default:
			return "";
	}
}

async function buildWorkspace(rung: Rung, surface: readonly { path: string; exports: readonly string[] }[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `oracle-adversary-${rung}-`));
	if (rung === "null") return dir;
	for (const entry of surface) {
		const file = join(dir, entry.path);
		await mkdir(dirname(file), { recursive: true });
		const decls = entry.exports.map((name) => body(rung, name)).join("\n");
		await writeFile(file, `/* adversary: ${rung} */\n${decls}\n`, "utf8");
	}
	return dir;
}

const probes = await listHeldOutProbes(probeDir);
if (probes.length === 0) {
	process.stdout.write(`No probes found for ${projectId} — nothing to gate.\n`);
	process.exit(2);
}
const surface = await deriveSurface(probes.map((probe) => probe.sourcePath));
if (surface.length === 0) {
	process.stdout.write(`Could not derive a module surface from ${projectId}'s probes — cannot build a forgery.\n`);
	process.exit(2);
}
process.stdout.write(
	`Oracle adversary ladder — ${projectId} (${probes.length} probe(s), ${surface.length} prescribed module(s))\n` +
		surface.map((entry) => `    ${entry.path}: ${entry.exports.join(", ") || "(no calls seen)"}`).join("\n") +
	"\n\n",
);

const rungs: Rung[] = ["null", "scaffold", "refuse-all", "allow-all", "shape-only"];
let forgeable = false;
for (const rung of rungs) {
	const workspace = await buildWorkspace(rung, surface);
	try {
		const verdict = await runHeldOutOracle({
			workspacePath: workspace,
			probeDir,
			repoRoot,
			projectAcceptanceCommand: "npm test",
		});
		const independent = verdict.independence.independent;
		const scored = `${verdict.failToPassPassed}/${verdict.failToPassTotal}`;
		const bad = !independent || verdict.failToPassPassed > 0;
		if (bad) forgeable = true;
		process.stdout.write(
			`  ${rung.padEnd(11)} independence=${independent ? "ok " : "FAIL"}  fail_to_pass=${scored}  ${
				bad ? "⟵ THE ORACLE ACCEPTS THIS FORGERY" : "expected 0 ✓"
			}\n`,
		);
	} finally {
		await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
	}
}
process.stdout.write(
	forgeable
		? "\nAt least one rung scored above zero: the oracle is forgeable at that level, so its other scores mean less than they appear.\n"
		: "\nEvery rung scored zero: the oracle discriminates work from every forgery on this ladder.\n",
);
process.exit(forgeable ? 1 : 0);
