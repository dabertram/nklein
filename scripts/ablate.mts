/**
 * P20.3b — the EFFECTFUL half of the no-op ablation: stub an artifact so it FAILS LOUDLY, re-run the same test
 * selection, and emit the two `{testId, passed}` JSONL files that `dev ablation` already judges.
 *
 *   tsx scripts/ablate.mts --module src/core/foo.ts --tests test/runtime/core/foo.test.ts --out-dir .ablation
 *   nklein dev ablation --baseline .ablation/baseline.jsonl --ablated .ablation/ablated.jsonl
 *
 * ── WHY THE STUB THROWS FROM EVERY EXPORT ──
 * A stub returning `null`, `0`, `[]` or `""` lets tests pass for the WRONG reason: an artifact that is genuinely
 * load-bearing but tolerant of empty input comes back `DECORATIVE`, and someone deletes working code on the
 * strength of it. That is the expensive direction of this measurement, so every stubbed entry point throws —
 * functions when called, values when read (via a throwing getter, since a plain `undefined` is exactly the
 * plausible default this exists to avoid).
 *
 * ── WHY THE SELECTION IS FIXED ONCE ──
 * The ablated run must exercise the SAME tests as the baseline. Re-deriving the selection after stubbing would
 * let a collection error silently shrink it, and a smaller all-green run reads as "nothing depended on this".
 * The selection is therefore computed once, and a run whose test COUNT changed is reported rather than judged.
 *
 * ── WHY THE STUB NEVER TOUCHES THE REPO ──
 * The stub is written into an ISOLATED COPY of the tree the suite needs, and BOTH runs happen there. An earlier
 * version stubbed the real file and restored it in a `finally` — correct, but a `finally` cannot survive a
 * SIGKILL, and the failure it would leave behind is a repo silently stubbed. Copying removes the class instead
 * of narrowing it; there is nothing to restore, because nothing was modified.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveExercisingTests } from "../src/core/exercising-tests";
import { assessNoOpAblation } from "../src/core/no-op-ablation";

const execFileAsync = promisify(execFile);

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? undefined : process.argv[index + 1];
}

const sweepDir = arg("sweep");
const modulePath = arg("module");
const testSelection = arg("tests");
// Default OUTSIDE the repo. `.ablation` was the old default and its four report files ended up committed —
// a tool whose whole property is "it modifies nothing" quietly dirtying the working tree on every run.
const outDir = arg("out-dir") ?? join(tmpdir(), "nklein-ablate-out");
if (!sweepDir && (!modulePath || !testSelection)) {
	process.stderr.write(
		"usage: ablate.mts --module <src/...ts> --tests <test pattern> [--out-dir <dir>]\n" +
			"       ablate.mts --sweep <src/core> [--limit <n>] [--out-dir <dir>]\n",
	);
	process.exit(64);
}

/**
 * Build an ISOLATED copy of the tree the suite needs, so the stub is never written into the real repo.
 *
 * The `finally` restore that preceded this is correct but cannot survive a SIGKILL, a power loss, or a second
 * process reading the file mid-run — and the failure it would leave behind is a repo silently stubbed. Copying
 * removes the whole class rather than narrowing it.
 *
 * Only what the suite loads is copied: three directories plus EVERY root-level file (~29 MB), versus 11 GB for
 * the full tree once nested `node_modules` and `vendor/` are counted. `node_modules` is SYMLINKED, not copied —
 * the one directory that is both enormous and identical by construction.
 *
 * Root files are taken wholesale rather than named. A hand-listed manifest went stale immediately: it missed
 * `tsconfig.base.json`, which `tsconfig.json` extends, and every run then collected ZERO tests. That surfaced
 * as `inconclusive` — the assessor's safety property doing its job, refusing to call three real modules
 * decorative on the strength of a broken harness — but a manifest that can silently omit a config is a defect
 * generator, and at 2.7 MB there is nothing to gain by curating it.
 *
 * The copy is of the WORKING TREE, not of HEAD. A `git worktree` would have been cheaper and was tried first,
 * but it checks out a COMMIT — so an ablation would silently measure committed code while reporting on the
 * code in front of you, which is the substitution this whole measurement exists to refuse.
 */
const ISOLATED_TREE_DIRS = ["src", "test", "scripts"] as const;

async function createIsolatedTree(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "nklein-ablate-"));
	for (const entry of ISOLATED_TREE_DIRS) {
		// `cp -R src dest` NESTS when dest already exists; naming the destination explicitly avoids that entirely.
		await execFileAsync("cp", ["-R", resolve(entry), join(root, entry)]);
	}
	for (const file of await readdir(process.cwd(), { withFileTypes: true })) {
		if (file.isFile()) {
			await execFileAsync("cp", [resolve(file.name), join(root, file.name)]);
		}
	}
	await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
	return root;
}

/** Run vitest over a fixed selection and reduce its JSON report to the `{testId, passed}` shape. */
async function runSelection(
	label: string,
	selection: string,
	outDir: string,
	root: string,
): Promise<Array<{ testId: string; passed: boolean }>> {
	// ABSOLUTE: vitest resolves `--outputFile` against `--root`, so a repo-relative path would write the report
	// into the isolated copy while the script looked for it in the repo — reported as "the selection did not
	// collect", which is a real failure mode wearing the wrong name.
	const reportPath = resolve(outDir, `${label}-report.json`);
	try {
		await execFileAsync(
			"npx",
			[
				"vitest",
				"run",
				"--root",
				root,
				...selection.split(" ").filter(Boolean),
				"--reporter=json",
				`--outputFile=${reportPath}`,
			],
			{ maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 },
		);
	} catch {
		// A failing suite is the EXPECTED outcome of the ablated run; the report is what matters, not the exit code.
	}
	if (!existsSync(reportPath)) {
		throw new Error(`${label}: vitest produced no report at ${reportPath} — the selection may not have collected`);
	}
	const report = JSON.parse(await readFile(reportPath, "utf8")) as {
		testResults?: Array<{ name: string; assertionResults?: Array<{ fullName?: string; title?: string; status: string }> }>;
	};
	const rows: Array<{ testId: string; passed: boolean }> = [];
	for (const file of report.testResults ?? []) {
		for (const assertion of file.assertionResults ?? []) {
			rows.push({
				testId: `${file.name}::${assertion.fullName ?? assertion.title ?? "?"}`,
				passed: assertion.status === "passed",
			});
		}
	}
	return rows;
}

const writeJsonl = async (path: string, rows: readonly { testId: string; passed: boolean }[]) =>
	await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

/** A stub whose every export fails loudly — functions on call, values on READ. */
async function buildThrowingStub(target: string): Promise<string> {
	const loaded = (await import(pathToFileURL(resolve(target)).href)) as Record<string, unknown>;
	const names = Object.keys(loaded).filter((name) => name !== "default");
	// TYPE-only exports are invisible to a runtime import, so a value-only stub silently DROPS them — and any test
	// importing a type from the module then fails to COLLECT. That shrinks the selection, which the assessor
	// (correctly) refuses to judge, so three real modules came back `inconclusive` in the first 30-module sweep
	// for a harness reason. Re-declare them as `any` so collection survives while every VALUE still throws.
	const source = await readFile(resolve(target), "utf8");
	const typeNames = [...source.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gmu)].map(
		(match) => match[1] as string,
	);
	const marker = `ABLATED_STUB: ${target} was stubbed by scripts/ablate.mts and must not be reachable`;
	const lines = [
		`// AUTO-GENERATED by scripts/ablate.mts into an isolated tree copy — the real repo is never modified.`,
		`const fail = (name) => { throw new Error(\`${marker} (via \${name})\`); };`,
	];
	for (const name of names) {
		if (typeof loaded[name] === "function") {
			lines.push(`export const ${name} = (...args) => fail(${JSON.stringify(name)});`);
		} else {
			// A throwing GETTER, not `undefined`: a plausible default is the false-accusation path this avoids.
			lines.push(`export const ${name} = new Proxy({}, { get: () => fail(${JSON.stringify(name)}) });`);
		}
	}
	for (const typeName of [...new Set(typeNames)]) {
		lines.push(`export type ${typeName} = any;`);
	}
	if (names.length === 0 && typeNames.length === 0) {
		throw new Error(`${target} exports nothing importable — there is nothing to ablate`);
	}
	return `${lines.join("\n")}\n`;
}


/**
 * Ablate ONE module and return the assessor's verdict. The judgement happens IN PROCESS via
 * `assessNoOpAblation` rather than by parsing CLI text — a sweep that scrapes stdout can silently produce an
 * empty verdict and report it as a result, which is exactly how an ad-hoc batch wrapper over this script
 * mis-reported 12 cores before this mode existed.
 */
async function ablateOne(
	module: string,
	selection: string,
	workDir: string,
): Promise<{ verdict: string; reason: string; baseline: number; ablatedPassing: number; countsMatch: boolean }> {
	await mkdir(workDir, { recursive: true });
	// The stub is built from the REAL module (it imports it to discover the exports) but written only into the
	// isolated copy. The host file is opened for reading and never for writing.
	const stub = await buildThrowingStub(module);
	const isolatedRoot = await createIsolatedTree();
	const isolatedTarget = join(isolatedRoot, module);
	try {
		// BOTH runs happen in the copy. Running the baseline on the host and the ablated run in the copy would
		// attribute every environmental difference between the two trees to the artifact.
		const baseline = await runSelection("baseline", selection, workDir, isolatedRoot);
		await writeJsonl(join(workDir, "baseline.jsonl"), baseline);

		await writeFile(isolatedTarget, stub, "utf8");
		const ablated = await runSelection("ablated", selection, workDir, isolatedRoot);
		await writeJsonl(join(workDir, "ablated.jsonl"), ablated);

		const assessment = assessNoOpAblation({ baseline, ablated });
		return {
			verdict: assessment.verdict,
			reason: assessment.reason ?? "",
			baseline: baseline.length,
			ablatedPassing: ablated.filter((row) => row.passed).length,
			countsMatch: ablated.length === baseline.length,
		};
	} finally {
		// Nothing to restore — the repo was never modified. Removing the copy is tidiness, not safety, so a failure
		// here must not mask the verdict.
		await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
	}
}

if (sweepDir) {
	// Pair each `src/<dir>/<name>.ts` with `test/runtime/<dir>/<name>.test.ts`; unpaired modules are SKIPPED and
	// counted, never silently dropped — a sweep that quietly shrinks its own scope reports a clean bill of health
	// for code it never looked at.
	const limit = Number(arg("limit") ?? "25");
	const suffix = sweepDir.replace(/^src\//, "");
	// `.test.ts` files live alongside sources in some directories; counting them as MODULES inflated the
	// "unexercised" figure by six on the first run. A test file is not an artifact to ablate.
	const modules = (await readdir(sweepDir))
		.filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"))
		.sort();
	const pairs: Array<{ module: string; selection: string }> = [];
	const unexercised: string[] = [];
	const typeOnly: string[] = [];
	const viaBarrel: string[] = [];

	/**
	 * A module re-exported by a barrel that tests DO import is reached — the importer grep just cannot see it,
	 * because no test names its path. That under-reporting is what turned 2 genuine gaps into a list of 14: every
	 * `*-api-contract` reached through `core/api-contract` looked untouched.
	 *
	 * Reported as its own bucket rather than folded into "exercised", because a barrel importer does not
	 * necessarily use THIS module's symbols, and stubbing it would break every barrel importer at import time —
	 * a LOAD_BEARING verdict earned by the barrel, not by the module. Not a naming gap, not a judgeable pairing.
	 */
	async function reExportedByAnImportedBarrel(dir: string, base: string): Promise<boolean> {
		let siblings: string[] = [];
		try {
			siblings = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
		} catch {
			return false;
		}
		const reExport = new RegExp(`export\\s+\\*\\s+from\\s+["']\\./${base}(\\.js|\\.ts)?["']`, "u");
		for (const sibling of siblings) {
			const barrelBase = sibling.replace(/\.ts$/, "");
			if (barrelBase === base) {
				continue;
			}
			let text = "";
			try {
				text = await readFile(join(dir, sibling), "utf8");
			} catch {
				continue;
			}
			if (!reExport.test(text)) {
				continue;
			}
			try {
				const { stdout } = await execFileAsync("grep", ["-rl", `${suffix}/${barrelBase}"`, "test/"], {
					maxBuffer: 8 * 1024 * 1024,
				});
				if (stdout.split("\n").some((line) => line.endsWith(".test.ts"))) {
					return true;
				}
			} catch {
				// no test imports this barrel either — keep looking at other barrels
			}
		}
		return false;
	}

	/**
	 * A type-only module emits NO runtime code, so it can never be "exercised" and an ablation stub would change
	 * nothing. Counting it as unexercised inflates the gap and invites a decorative test — that is exactly what
	 * happened to `nklein-task-session-service-types`, which sat in a 16-module gap list as the one entry that was
	 * never a gap at all.
	 *
	 * Measured, not pattern-matched: a single-file esbuild transform of a type-only module is zero bytes. Regexing
	 * for `export type` would misjudge any module that mixes types with runtime values.
	 *
	 * A FAILED transform yields null, never `true`. The first version of this probe passed `--loader=ts`, which
	 * esbuild rejects for a file with an extension; every module then measured 0 bytes and would have been
	 * classified type-only — an error reported as a clean measurement. Unknown counts as a possible gap.
	 */
	async function emitsNoRuntimeCode(modulePath: string): Promise<boolean | null> {
		try {
			const { stdout } = await execFileAsync("npx", ["esbuild", modulePath, "--format=esm"], {
				maxBuffer: 8 * 1024 * 1024,
			});
			return stdout.trim().length === 0;
		} catch {
			return null;
		}
	}

	// The pairing RULE lives in `src/core/exercising-tests.ts` so the P20.3b delivery seam gets the same answer;
	// only the IO is supplied here. Two implementations of "which tests exercise this module" would drift, and
	// one would call a module unexercised while the other measured it.
	const lookup = {
		fileExists: (path: string) => existsSync(path),
		findImportingTests: async (specifier: string) => {
			try {
				const { stdout } = await execFileAsync("grep", ["-rl", specifier, "test/"], { maxBuffer: 8 * 1024 * 1024 });
				return stdout.split("\n");
			} catch {
				// grep exits non-zero when nothing matches; that is the genuinely-unexercised case.
				return [];
			}
		},
	};

	for (const file of modules) {
		const base = file.replace(/\.ts$/, "");
		const exercising = await resolveExercisingTests(join(sweepDir, file), lookup);
		if (exercising.length > 0) {
			pairs.push({ module: join(sweepDir, file), selection: exercising.join(" ") });
			continue;
		}
		// No test names this path — but that is THREE different facts, and only one of them is a gap.
		const modulePath = join(sweepDir, file);
		if ((await emitsNoRuntimeCode(modulePath)) === true) {
			typeOnly.push(modulePath);
		} else if (await reExportedByAnImportedBarrel(sweepDir, base)) {
			viaBarrel.push(modulePath);
		} else {
			unexercised.push(modulePath);
		}
	}
	const scope = pairs.slice(0, limit);
	process.stdout.write(
		`sweep: ${scope.length} of ${pairs.length} module(s) with an exercising test ` +
			`(${unexercised.length} unexercised — reached by NO test at all, SKIPPED, not judged` +
			`${viaBarrel.length > 0 ? `; ${viaBarrel.length} reached only via an imported barrel` : ""}` +
			`${typeOnly.length > 0 ? `; ${typeOnly.length} type-only, emitting no runtime code — NOT a gap` : ""})\n\n`,
	);
	// Named, not just counted — for BOTH buckets. A bare "14 unexercised" is a percentage in disguise: nobody can
	// act on it, and it stays 14 forever. A named list is a work queue, and it also makes a wrong count visible.
	for (const modulePath of unexercised) {
		process.stdout.write(`unexercised    ${modulePath}\n`);
	}
	if (unexercised.length > 0) {
		process.stdout.write("\n");
	}
	for (const modulePath of viaBarrel) {
		process.stdout.write(`via_barrel     ${modulePath}  (re-exported by a barrel tests import — reached, not directly judgeable)\n`);
	}
	if (viaBarrel.length > 0) {
		process.stdout.write("\n");
	}
	for (const modulePath of typeOnly) {
		process.stdout.write(`type_only      ${modulePath}  (no runtime code — nothing to exercise or ablate)\n`);
	}
	if (typeOnly.length > 0) {
		process.stdout.write("\n");
	}
	const tally = new Map<string, number>();
	for (const [index, pair] of scope.entries()) {
		const workDir = join(outDir, `sweep-${index}`);
		try {
			const result = await ablateOne(pair.module, pair.selection, workDir);
			tally.set(result.verdict, (tally.get(result.verdict) ?? 0) + 1);
			const flag = result.countsMatch ? "" : "  ⚠ COUNT MISMATCH — not judgeable";
			process.stdout.write(`${result.verdict.padEnd(14)} ${pair.module}${flag}\n`);
			if (result.verdict !== "load_bearing") {
				process.stdout.write(`               ${result.reason}\n`);
			}
		} catch (error) {
			tally.set("error", (tally.get("error") ?? 0) + 1);
			process.stdout.write(`${"ERROR".padEnd(14)} ${pair.module}: ${error instanceof Error ? error.message : String(error)}\n`);
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	}
	process.stdout.write(`\nsummary: ${[...tally].map(([k, v]) => `${k}=${v}`).join(" · ") || "nothing ran"}\n`);
	process.stdout.write(
		`${unexercised.length} module(s) are reached by no test at all — unexercised, therefore NOT judged ` +
			`(neither load-bearing nor decorative).\n`,
	);
	if (viaBarrel.length > 0) {
		process.stdout.write(
			`${viaBarrel.length} module(s) are reached ONLY through a barrel that tests import — covered in effect, ` +
				`but stubbing one breaks every barrel importer at import time, so the verdict would belong to the barrel.\n`,
		);
	}
	if (typeOnly.length > 0) {
		process.stdout.write(
			`${typeOnly.length} module(s) emit no runtime code (type-only) — NOT a coverage gap and not closable by ` +
				`a test; their verifier is \`tsc --noEmit\`.\n`,
		);
	}
} else {
	const result = await ablateOne(modulePath as string, testSelection as string, outDir);
	process.stdout.write(
		`${result.baseline} test(s) baseline · ${result.ablatedPassing} still passing when stubbed\n` +
			`${result.countsMatch ? "" : "⚠ COUNT MISMATCH — a stub that breaks collection is not judgeable\n"}` +
			`NO-OP ABLATION: ${result.verdict.toUpperCase()}\n  ${result.reason}\n`,
	);
}
