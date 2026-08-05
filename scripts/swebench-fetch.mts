/**
 * N8 — SWE-bench tranche fetcher: the EXPLICIT dataset/repo egress step (todo F11.3/N8: "dataset/repo egress
 * remains an explicit operator step"). Everything downstream of this tool is hermetic: the nightly cells
 * materialize instances from the local cache and refuse (naming this command) when it is absent.
 *
 *   tsx scripts/swebench-fetch.mts index                      # fetch the Lite+Verified index → candidate table
 *   tsx scripts/swebench-fetch.mts materialize <id> [...ids]  # download+pin repo snapshots for chosen instances
 *
 * Selection bar (N8): small PURE-PYTHON repos only (no C toolchain on the arm64 sandbox), bounded golden-diff
 * scope, deterministic fast test command, fits the 32k-context small-model reality. The four repos below are
 * the Lite/Verified pool members that clear it; everything else is filtered out at index time.
 *
 * Cache layout (.nklein-bench/swebench/, git-ignored):
 *   index.json                 — the filtered candidate rows (instance metadata, gold patch EXCLUDED)
 *   instances/<id>.json        — one chosen instance's metadata (problem, F2P/P2P, test_patch; gold EXCLUDED)
 *   repos/<id>.tar.gz          — the repo snapshot at base_commit (codeload tarball, sha256-pinned)
 *   pins.json                  — instance_id → {repo, baseCommit, tarballSha256, bytes} for reproducibility
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_ROOT = join(process.cwd(), ".nklein-bench", "swebench");
const DATASETS = ["princeton-nlp/SWE-bench_Lite", "princeton-nlp/SWE-bench_Verified"] as const;
/** Pure-python, small-enough repos from the Lite/Verified pool — the N8 suitability bar. */
const SUITABLE_REPOS = new Set(["psf/requests", "pallets/flask", "pytest-dev/pytest", "pylint-dev/pylint"]);

interface InstanceRow {
	readonly instance_id: string;
	readonly repo: string;
	readonly base_commit: string;
	readonly problem_statement: string;
	readonly patch: string;
	readonly test_patch: string;
	readonly FAIL_TO_PASS: string;
	readonly PASS_TO_PASS: string;
	readonly version?: string;
}

async function fetchDatasetRows(dataset: string): Promise<InstanceRow[]> {
	const rows: InstanceRow[] = [];
	let offset = 0;
	for (;;) {
		const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${offset}&length=100`;
		const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
		if (!response.ok) {
			throw new Error(`datasets-server ${response.status} for ${dataset} @${offset}`);
		}
		const page = (await response.json()) as { rows: { row: InstanceRow }[]; num_rows_total: number };
		rows.push(...page.rows.map((entry) => entry.row));
		offset += page.rows.length;
		if (offset >= page.num_rows_total || page.rows.length === 0) {
			return rows;
		}
	}
}

function parseTestList(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

interface Candidate {
	readonly instanceId: string;
	readonly repo: string;
	readonly baseCommit: string;
	readonly datasets: string[];
	readonly failToPass: string[];
	readonly passToPass: string[];
	readonly testPatch: string;
	readonly problemStatement: string;
	readonly problemChars: number;
	readonly goldPatchBytes: number;
	readonly goldPatchFiles: number;
	readonly version: string | null;
}

async function commandIndex(): Promise<void> {
	process.stdout.write(
		`⚠ EGRESS (explicit operator step): fetching the SWE-bench Lite+Verified index from huggingface.co…\n`,
	);
	const byId = new Map<string, Candidate>();
	for (const dataset of DATASETS) {
		const rows = await fetchDatasetRows(dataset);
		process.stdout.write(`  ${dataset}: ${rows.length} rows\n`);
		for (const row of rows) {
			if (!SUITABLE_REPOS.has(row.repo)) {
				continue;
			}
			const existing = byId.get(row.instance_id);
			if (existing) {
				existing.datasets.push(dataset);
				continue;
			}
			byId.set(row.instance_id, {
				instanceId: row.instance_id,
				repo: row.repo,
				baseCommit: row.base_commit,
				datasets: [dataset],
				failToPass: parseTestList(row.FAIL_TO_PASS),
				passToPass: parseTestList(row.PASS_TO_PASS),
				testPatch: row.test_patch,
				problemStatement: row.problem_statement,
				problemChars: row.problem_statement.length,
				goldPatchBytes: Buffer.byteLength(row.patch, "utf8"),
				goldPatchFiles: [...row.patch.matchAll(/^diff --git /gm)].length,
				// The gold patch itself is measured, then DROPPED — it must never reach the cache (leakage).
				version: row.version ?? null,
			});
		}
	}
	const candidates = [...byId.values()].sort(
		(left, right) => left.goldPatchBytes - right.goldPatchBytes || left.instanceId.localeCompare(right.instanceId),
	);
	await mkdir(CACHE_ROOT, { recursive: true });
	await writeFile(
		join(CACHE_ROOT, "index.json"),
		`${JSON.stringify(
			candidates.map(({ testPatch, problemStatement, ...summary }) => summary),
			null,
			1,
		)}\n`,
	);
	// Full rows (incl. test_patch + problem text, still NO gold patch) go to per-instance staging for materialize.
	await mkdir(join(CACHE_ROOT, "staging"), { recursive: true });
	for (const candidate of candidates) {
		await writeFile(join(CACHE_ROOT, "staging", `${candidate.instanceId}.json`), `${JSON.stringify(candidate, null, 1)}\n`);
	}
	process.stdout.write(`suitable candidates: ${candidates.length} → ${join(CACHE_ROOT, "index.json")}\n`);
	for (const candidate of candidates.slice(0, 40)) {
		process.stdout.write(
			`  ${candidate.instanceId}  patch=${candidate.goldPatchBytes}B/${candidate.goldPatchFiles}f  f2p=${candidate.failToPass.length}  p2p=${candidate.passToPass.length}  problem=${candidate.problemChars}ch  [${candidate.datasets.map((d) => (d.endsWith("Verified") ? "V" : "L")).join("")}]\n`,
		);
	}
}

async function commandMaterialize(instanceIds: readonly string[]): Promise<void> {
	if (instanceIds.length === 0) {
		throw new Error("materialize needs at least one instance id (run `index` first, then choose).");
	}
	const pinsPath = join(CACHE_ROOT, "pins.json");
	const pins: Record<string, { repo: string; baseCommit: string; tarballSha256: string; bytes: number }> = existsSync(
		pinsPath,
	)
		? (JSON.parse(await readFile(pinsPath, "utf8")) as Record<
				string,
				{ repo: string; baseCommit: string; tarballSha256: string; bytes: number }
			>)
		: {};
	await mkdir(join(CACHE_ROOT, "instances"), { recursive: true });
	await mkdir(join(CACHE_ROOT, "repos"), { recursive: true });
	for (const instanceId of instanceIds) {
		const stagingPath = join(CACHE_ROOT, "staging", `${instanceId}.json`);
		if (!existsSync(stagingPath)) {
			throw new Error(`no staged metadata for ${instanceId} — run \`index\` first.`);
		}
		const candidate = JSON.parse(await readFile(stagingPath, "utf8")) as Candidate;
		const tarballPath = join(CACHE_ROOT, "repos", `${instanceId}.tar.gz`);
		if (!existsSync(tarballPath)) {
			const url = `https://codeload.github.com/${candidate.repo}/tar.gz/${candidate.baseCommit}`;
			process.stdout.write(`⚠ EGRESS: ${url}\n`);
			const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
			if (!response.ok) {
				throw new Error(`codeload ${response.status} for ${instanceId}`);
			}
			const bytes = Buffer.from(await response.arrayBuffer());
			await writeFile(tarballPath, bytes);
		}
		const bytes = await readFile(tarballPath);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		pins[instanceId] = {
			repo: candidate.repo,
			baseCommit: candidate.baseCommit,
			tarballSha256: sha256,
			bytes: bytes.length,
		};
		await writeFile(join(CACHE_ROOT, "instances", `${instanceId}.json`), `${JSON.stringify(candidate, null, 1)}\n`);
		process.stdout.write(
			`  pinned ${instanceId}: ${(bytes.length / 1024 / 1024).toFixed(1)}MB sha256:${sha256.slice(0, 12)}…\n`,
		);
	}
	await writeFile(pinsPath, `${JSON.stringify(pins, null, 1)}\n`);
	process.stdout.write(`pins → ${pinsPath}\n`);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "index") {
	await commandIndex();
} else if (mode === "materialize") {
	await commandMaterialize(args);
} else {
	process.stderr.write("usage: swebench-fetch.mts index | materialize <instance_id...>\n");
	process.exit(64);
}
