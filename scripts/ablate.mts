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
 * The original module is restored in a `finally`, and the restore is verified — leaving a repo stubbed would be
 * a far worse failure than any verdict this produces.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assessNoOpAblation } from "../src/core/no-op-ablation";

const execFileAsync = promisify(execFile);

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? undefined : process.argv[index + 1];
}

const sweepDir = arg("sweep");
const modulePath = arg("module");
const testSelection = arg("tests");
const outDir = arg("out-dir") ?? ".ablation";
if (!sweepDir && (!modulePath || !testSelection)) {
	process.stderr.write(
		"usage: ablate.mts --module <src/...ts> --tests <test pattern> [--out-dir <dir>]\n" +
			"       ablate.mts --sweep <src/core> [--limit <n>] [--out-dir <dir>]\n",
	);
	process.exit(64);
}

/** Run vitest over a fixed selection and reduce its JSON report to the `{testId, passed}` shape. */
async function runSelection(
	label: string,
	selection: string,
	outDir: string,
): Promise<Array<{ testId: string; passed: boolean }>> {
	const reportPath = join(outDir, `${label}-report.json`);
	try {
		await execFileAsync(
			"npx",
			["vitest", "run", selection, "--reporter=json", `--outputFile=${reportPath}`],
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
		`// AUTO-GENERATED by scripts/ablate.mts — the original is restored in a finally block.`,
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
	const target = resolve(module);
	const backup = join(workDir, "original.bak");

	const baseline = await runSelection("baseline", selection, workDir);
	await writeJsonl(join(workDir, "baseline.jsonl"), baseline);

	const stub = await buildThrowingStub(module);
	await copyFile(target, backup);
	let ablated: Array<{ testId: string; passed: boolean }> = [];
	let restored = false;
	try {
		await writeFile(target, stub, "utf8");
		ablated = await runSelection("ablated", selection, workDir);
		await writeJsonl(join(workDir, "ablated.jsonl"), ablated);
	} finally {
		await copyFile(backup, target);
		restored = (await readFile(target, "utf8")) !== stub;
		await rm(backup, { force: true });
	}
	if (!restored) {
		throw new Error(`FAILED TO RESTORE ${module} — the repo is left stubbed; restore before continuing`);
	}
	const assessment = assessNoOpAblation({ baseline, ablated });
	return {
		verdict: assessment.verdict,
		reason: assessment.reason ?? "",
		baseline: baseline.length,
		ablatedPassing: ablated.filter((row) => row.passed).length,
		countsMatch: ablated.length === baseline.length,
	};
}

if (sweepDir) {
	// Pair each `src/<dir>/<name>.ts` with `test/runtime/<dir>/<name>.test.ts`; unpaired modules are SKIPPED and
	// counted, never silently dropped — a sweep that quietly shrinks its own scope reports a clean bill of health
	// for code it never looked at.
	const { readdir } = await import("node:fs/promises");
	const limit = Number(arg("limit") ?? "25");
	const suffix = sweepDir.replace(/^src\//, "");
	const modules = (await readdir(sweepDir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort();
	const pairs: Array<{ module: string; selection: string }> = [];
	let unpaired = 0;
	for (const file of modules) {
		const selection = `test/runtime/${suffix}/${file.replace(/\.ts$/, ".test.ts")}`;
		if (existsSync(selection)) {
			pairs.push({ module: join(sweepDir, file), selection });
		} else {
			unpaired += 1;
		}
	}
	const scope = pairs.slice(0, limit);
	process.stdout.write(
		`sweep: ${scope.length} of ${pairs.length} paired module(s) (${unpaired} module(s) have no matching test and are SKIPPED, not judged)\n\n`,
	);
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
			if (String(error).includes("FAILED TO RESTORE")) {
				process.exit(3); // never keep sweeping over a stubbed repo
			}
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	}
	process.stdout.write(`\nsummary: ${[...tally].map(([k, v]) => `${k}=${v}`).join(" · ") || "nothing ran"}\n`);
	process.stdout.write(`${unpaired} module(s) skipped for want of a matching test — they were NOT judged.\n`);
} else {
	const result = await ablateOne(modulePath as string, testSelection as string, outDir);
	process.stdout.write(
		`${result.baseline} test(s) baseline · ${result.ablatedPassing} still passing when stubbed\n` +
			`${result.countsMatch ? "" : "⚠ COUNT MISMATCH — a stub that breaks collection is not judgeable\n"}` +
			`NO-OP ABLATION: ${result.verdict.toUpperCase()}\n  ${result.reason}\n`,
	);
}
