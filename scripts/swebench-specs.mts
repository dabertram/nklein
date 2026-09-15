/**
 * P1.SWEBENCHFULL slice (1) — the upstream environment-spec table, fetched ONCE as an explicit egress step.
 *
 *   tsx scripts/swebench-specs.mts fetch [<swebench version>]   # ⚠ EGRESS: pip download the `swebench` package
 *   tsx scripts/swebench-specs.mts show                          # summarize the cached table (offline)
 *
 * The `swebench` PyPI package carries `swebench.harness.constants.MAP_REPO_VERSION_TO_SPECS` — per (repo, version):
 * python, pre_install shell, packages, install command, pip_packages, test_cmd — the evidence every SWE-bench
 * evaluation harness runs on. `fetch` downloads the wheel (no deps), records its sha256, unzips it into a temp
 * dir and dumps the table with the host's python3 (constants are pure python; nothing is installed) into
 * `.nklein-bench/swebench/specs.json` with provenance. Nothing downstream ever guesses an environment.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseSwebenchSpecDump } from "../src/core/swebench-env-spec";
import { swebenchCacheRoot } from "../src/core/swebench-materialize";
import { loadSwebenchSpecTable, swebenchSpecTablePath } from "../src/core/swebench-spec-table";

const execFileAsync = promisify(execFile);
const cacheRoot = swebenchCacheRoot(process.cwd());

const DUMP_SCRIPT = `
import json, sys
from swebench.harness.constants import MAP_REPO_VERSION_TO_SPECS
parsers = {}
try:
    from swebench.harness.log_parsers import MAP_REPO_TO_PARSER
    parsers = {repo: getattr(fn, "__name__", str(fn)) for repo, fn in MAP_REPO_TO_PARSER.items()}
except Exception as error:  # parser map is informational; the table is what matters
    parsers = {"__error__": str(error)}
def plain(value):
    if isinstance(value, dict): return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)): return [plain(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None: return value
    return str(value)
json.dump({"specs": plain(MAP_REPO_VERSION_TO_SPECS), "parsers": parsers}, sys.stdout)
`;

async function commandFetch(requestedVersion: string | undefined): Promise<void> {
	const work = await mkdtemp(join(tmpdir(), "swebench-specs-"));
	try {
		const requirement = requestedVersion ? `swebench==${requestedVersion}` : "swebench";
		process.stdout.write(`⚠ EGRESS (explicit operator step): pip download ${requirement} --no-deps from PyPI…\n`);
		await execFileAsync("python3", [
			"-m",
			"pip",
			"download",
			"--disable-pip-version-check",
			"--no-deps",
			"--only-binary=:all:",
			"--dest",
			work,
			requirement,
		]);
		const wheel = (await readdir(work)).find((name) => name.endsWith(".whl"));
		if (!wheel) {
			throw new Error("pip download produced no wheel");
		}
		const bytes = await readFile(join(work, wheel));
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const version = wheel.split("-")[1] ?? "unknown";
		const unpacked = join(work, "unpacked");
		await mkdir(unpacked, { recursive: true });
		await execFileAsync("python3", ["-c", `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, join(work, wheel), unpacked]);
		const { stdout } = await execFileAsync("python3", ["-c", DUMP_SCRIPT], {
			env: { ...process.env, PYTHONPATH: unpacked },
			maxBuffer: 64 * 1024 * 1024,
		});
		const dumped = JSON.parse(stdout) as { specs: Record<string, Record<string, Record<string, unknown>>>; parsers: Record<string, string> };
		const dump = {
			source: { package: "swebench", version, sha256, wheel, generatedAt: new Date().toISOString() },
			parsers: dumped.parsers,
			specs: dumped.specs,
		};
		await mkdir(cacheRoot, { recursive: true });
		await writeFile(swebenchSpecTablePath(cacheRoot), `${JSON.stringify(dump, null, 1)}\n`);
		const table = parseSwebenchSpecDump(dump);
		process.stdout.write(
			`specs.json: swebench ${version} (sha256 ${sha256.slice(0, 12)}…) — ${table.specs.length} (repo, version) rows across ${new Set(table.specs.map((spec) => spec.repo)).size} repos → ${swebenchSpecTablePath(cacheRoot)}\n`,
		);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

async function commandShow(): Promise<void> {
	const table = await loadSwebenchSpecTable(cacheRoot);
	if (!table) {
		process.stdout.write(`no spec table at ${swebenchSpecTablePath(cacheRoot)} — run \`tsx scripts/swebench-specs.mts fetch\`\n`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(`swebench ${table.source.version} (sha256 ${table.source.sha256.slice(0, 12)}…), ${table.specs.length} rows\n`);
	const byRepo = new Map<string, typeof table.specs>();
	for (const spec of table.specs) {
		byRepo.set(spec.repo, [...(byRepo.get(spec.repo) ?? []), spec]);
	}
	for (const [repo, specs] of byRepo) {
		const pythons = [...new Set(specs.map((spec) => spec.python))].join("/");
		const parsers = [...new Set(specs.map((spec) => spec.logParser))].join("/");
		const apt = specs.filter((spec) => spec.preInstall.some((line) => /apt-get|apt /.test(line))).length;
		process.stdout.write(
			`  ${repo.padEnd(28)} ${String(specs.length).padStart(3)} versions  python ${pythons.padEnd(12)} parser ${parsers.padEnd(7)} apt pre-install in ${apt}  test: ${specs[specs.length - 1]?.testCmd}\n`,
		);
	}
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "fetch") {
	await commandFetch(args[0]);
} else if (mode === "show") {
	await commandShow();
} else {
	process.stderr.write("usage: swebench-specs.mts fetch [<version>] | show\n");
	process.exit(64);
}
