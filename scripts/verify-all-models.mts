/**
 * Cross-model sweep driver (§5.Z). Runs a named `verify-*.mts` harness across the full loaded LM Studio roster,
 * pinning each model via `NKLEIN_VERIFY_MODEL`, classifying the result, and honoring the deepseek-drop caveat: a model
 * that has vanished from `/v1/models` (crashed/unloaded) is recorded DROPPED and the sweep continues with the rest.
 *
 * Every harness in this repo passes the pinned model id straight to the session (it never mutates the user's saved
 * provider settings), so no restore is needed; each run gets a fresh isolated HOME under a `nklein-verify*` temp dir so
 * the harnesses' own real-HOME guard is satisfied and runs can't contaminate each other.
 *
 * Usage:  tsx scripts/verify-all-models.mts <harness> [modelSubstringFilter ...]
 *   e.g.  tsx scripts/verify-all-models.mts verify-decompose-isolation
 *         tsx scripts/verify-all-models.mts verify-chat-command-exec qwen gemma   # only ids matching a filter
 * Env: NKLEIN_VERIFY_BASE_URL (default http://127.0.0.1:1234/v1)
 *      NKLEIN_SWEEP_TIMEOUT_MS (per-model outer hard cap, default 420000)
 *      NKLEIN_SWEEP_MODELS     (comma list to override live discovery)
 *      NKLEIN_SWEEP_SPACING_MS (pause between models so consecutive-load fatigue doesn't suppress weaker models; default 0)
 *      NKLEIN_VERIFY_TIMEOUT_MS (forwarded to the harness's own internal budget; default 300000)
 *
 * Result symbols (matches cross-model-verification.md): ✅ PASS (exit 0) · ❌ FAIL (exit 1/2 — triage parse-gap→harden
 * vs capability-floor→⚠️ CANT by hand) · ⏱ TIMEOUT (outer cap hit) · 💥 DROPPED (model gone from /v1/models).
 */
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fetchLoadedModelIds } from "../src/core/lmstudio-loaded-models";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
// Generous-but-bounded budgets: slow models (esp. reasoning models) need room so a TIMEOUT means "genuinely too slow",
// not "we cut it off early" — but a hung run must still terminate + be recorded. Outer cap > harness budget so the
// harness reports its own INCOMPLETE/PARTIAL before the outer hard-kill (which yields a less-informative TIMEOUT).
const OUTER_TIMEOUT_MS = Number(process.env.NKLEIN_SWEEP_TIMEOUT_MS ?? "960000"); // 16 min outer hard cap
const HARNESS_TIMEOUT_MS = process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "840000"; // 14 min harness-internal budget
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MATRIX_LOG = join(REPO_ROOT, "docs", "dev", "cross-model-verification.md");

type Outcome = "PASS" | "PARTIAL" | "FAIL" | "TIMEOUT" | "DROPPED";
const SYMBOL: Record<Outcome, string> = { PASS: "✅", PARTIAL: "◑", FAIL: "❌", TIMEOUT: "⏱", DROPPED: "💥" };

interface ModelResult {
	model: string;
	outcome: Outcome;
	exitCode: number | null;
	lastLine: string;
	elapsedMs: number;
}

async function listLoadedModels(): Promise<string[]> {
	// ONLY models actually LOADED in memory (LM Studio `/api/v0/models` `state=loaded`). We deliberately do NOT fall back
	// to `/v1/models` (which lists every DOWNLOADED model) — sweeping a non-loaded model would auto-LOAD it, and loading
	// is the user's call, not ours (directive 2026-06-28; JIT-loading 35B–122B giants would also thrash VRAM/freeze).
	return fetchLoadedModelIds(BASE_URL);
}

/** Chat/reasoning models only — drop the embedder (and any other non-chat entry by id heuristic). */
function isChatModel(id: string): boolean {
	return !/embed/i.test(id);
}

async function resolveRoster(filters: string[]): Promise<string[]> {
	const override = process.env.NKLEIN_SWEEP_MODELS?.trim();
	const all = override ? override.split(",").map((s) => s.trim()).filter(Boolean) : (await listLoadedModels()).filter(isChatModel);
	if (filters.length === 0) {
		return all;
	}
	return all.filter((id) => filters.some((f) => id.toLowerCase().includes(f.toLowerCase())));
}

async function runOne(harness: string, model: string): Promise<ModelResult> {
	const start = Date.now();
	// The harnesses guard on HOME containing "nklein-verify"; mkdtemp under tmpdir with that prefix satisfies it.
	const home = await mkdtemp(join(tmpdir(), "nklein-verify-sweep-"));
	const tail: string[] = [];
	const pushLine = (chunk: string): void => {
		for (const raw of chunk.split("\n")) {
			const line = raw.trimEnd();
			if (line.length > 0) {
				tail.push(line);
				if (tail.length > 60) tail.shift();
			}
		}
		process.stdout.write(chunk);
	};

	const child = spawn("npx", ["tsx", `scripts/${harness}.mts`], {
		cwd: REPO_ROOT,
		env: {
			...process.env,
			HOME: home,
			NKLEIN_VERIFY_MODEL: model,
			NKLEIN_VERIFY_BASE_URL: BASE_URL,
			NKLEIN_VERIFY_TIMEOUT_MS: HARNESS_TIMEOUT_MS,
			NKLEIN_LIVE_TIMEOUT_MS: HARNESS_TIMEOUT_MS,
		},
	});
	child.stdout.on("data", (d: Buffer) => pushLine(d.toString()));
	child.stderr.on("data", (d: Buffer) => pushLine(d.toString()));

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, OUTER_TIMEOUT_MS);

	const exitCode = await new Promise<number | null>((resolve) => {
		child.on("close", (code) => resolve(code));
		child.on("error", () => resolve(null));
	});
	clearTimeout(timer);
	await rm(home, { recursive: true, force: true }).catch(() => null);

	const elapsedMs = Date.now() - start;
	// Deepseek-drop caveat: if the model is no longer loaded, the failure is a crash — record DROPPED, not FAIL.
	const stillLoaded = (await listLoadedModels()).includes(model);
	let outcome: Outcome;
	if (!stillLoaded && exitCode !== 0) {
		outcome = "DROPPED";
	} else if (timedOut) {
		outcome = "TIMEOUT";
	} else if (exitCode === 0) {
		outcome = "PASS";
	} else if (exitCode === 3) {
		// A harness's graded ◑ PARTIAL: the real capability ran but a strict quality gate (e.g. reply-echo) wasn't met.
		outcome = "PARTIAL";
	} else {
		outcome = "FAIL";
	}
	const lastLine =
		[...tail].reverse().find((l) => /PASS|PARTIAL|FAIL|INCOMPLETE|DROPPED|FATAL|✓|◑|⚠️|result/i.test(l)) ?? tail.at(-1) ?? "(no output)";
	return { model, outcome, exitCode, lastLine: lastLine.slice(0, 200), elapsedMs };
}

async function main(): Promise<void> {
	const [harness, ...filters] = process.argv.slice(2);
	if (!harness) {
		console.error("usage: tsx scripts/verify-all-models.mts <harness> [modelSubstringFilter ...]");
		process.exit(64);
	}
	const roster = await resolveRoster(filters);
	if (roster.length === 0) {
		console.error(`No matching loaded models (filters: ${filters.join(", ") || "none"}). Is LM Studio running at ${BASE_URL}?`);
		process.exit(1);
	}
	console.log(`\n=== Cross-model sweep: ${harness} across ${roster.length} model(s) ===`);
	console.log(roster.map((m, i) => `  ${i + 1}. ${m}`).join("\n"));

	// Optional inter-model spacing (§4A: sustained back-to-back runs degrade/stall weaker models under Low Power —
	// coder-14b went 0/4 consecutive but ✅ standalone; a qwen3-8b C0 stalled on its 3rd consecutive run). A pause
	// between models lets the endpoint settle so a sweep measures capability, not consecutive-load fatigue.
	const spacingMs = Math.max(0, Number.parseInt(process.env.NKLEIN_SWEEP_SPACING_MS ?? "0", 10) || 0);

	const results: ModelResult[] = [];
	for (const [index, model] of roster.entries()) {
		if (index > 0 && spacingMs > 0) {
			console.log(`(pausing ${Math.round(spacingMs / 1000)}s between models to avoid consecutive-load fatigue)`);
			await new Promise((settle) => setTimeout(settle, spacingMs));
		}
		console.log(`\n──────── ${harness} · ${model} ────────`);
		// Pre-check: a model already gone before its turn is DROPPED without a wasted run.
		if (!(await listLoadedModels()).includes(model)) {
			console.log(`(model not loaded — recording DROPPED)`);
			results.push({ model, outcome: "DROPPED", exitCode: null, lastLine: "model not loaded at start", elapsedMs: 0 });
			continue;
		}
		const result = await runOne(harness, model);
		console.log(`→ ${SYMBOL[result.outcome]} ${result.outcome} (${Math.round(result.elapsedMs / 1000)}s) · ${result.lastLine}`);
		results.push(result);
	}

	const rowCells = results.map((r) => `${r.model.split("/").pop()}=${SYMBOL[r.outcome]}`).join(" ");
	const summary = [
		"",
		"════════ SWEEP SUMMARY ════════",
		`harness: ${harness}`,
		...results.map((r) => `  ${SYMBOL[r.outcome]} ${r.outcome.padEnd(8)} ${r.model.padEnd(38)} ${Math.round(r.elapsedMs / 1000)}s  ${r.lastLine}`),
		"",
		`matrix row → ${rowCells}`,
	].join("\n");
	console.log(summary);

	const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
	const logBlock =
		`\n### ${stamp} · ${harness}\n` +
		results.map((r) => `- ${SYMBOL[r.outcome]} **${r.outcome}** · \`${r.model}\` · ${Math.round(r.elapsedMs / 1000)}s · ${r.lastLine}`).join("\n") +
		`\n  - matrix row: ${rowCells}\n`;
	await appendFile(MATRIX_LOG, logBlock, "utf8").catch((e) => console.error(`(could not append to ${MATRIX_LOG}: ${e})`));

	// Exit non-zero only if EVERY model failed outright (a sweep with some passes/partials is a successful sweep).
	const anyPass = results.some((r) => r.outcome === "PASS" || r.outcome === "PARTIAL");
	process.exit(anyPass ? 0 : 1);
}

main().catch((error) => {
	console.error(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
