/**
 * Turn one HITL rig drive into a committed aimock SCENARIO SET — the system test for that dev-test project.
 *
 * ── WHY ──
 * A drive through the rig is already a recording (`scripts/hitl-queue-to-capture.mts` explains why), but turning it
 * into a durable test took four manual steps, and the manual sequence has a silent failure mode: forget to note the
 * queue mark BEFORE seeding and the capture silently swallows the previous project's traffic, producing a scenario
 * set that replays the wrong run under the right name. `mark` writes the boundary down; `record` reads it back.
 *
 *   npx tsx scripts/hitl-record-project.mts mark   <projectId>       # BEFORE seeding
 *   npx tsx scripts/hitl-record-project.mts record <projectId>       # after the drive drains
 *
 * `record` writes packages/llm-simulator/scenarios/<projectId>/{perfect-run.json,sources.json,README.md} and then
 * tells you the one command that PROVES the recording replays. A recording that has never been replayed is not a
 * test; it is a hope.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const command = process.argv[2];
const projectId = process.argv[3];
const REPO = resolve(new URL("..", import.meta.url).pathname);
const DRAIN = process.env.HITL_DRAIN ?? join(homedir(), ".nklein", "factory-drains", "hitl-drain");
const QUEUE = join(DRAIN, "queue");
const MARKS = join(DRAIN, "recording-marks");

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}
if (!command || !projectId) {
	fail("Usage: npx tsx scripts/hitl-record-project.mts <mark|record> <devTestProjectId>");
}

/** The highest request id the queue has ever seen — answered or not. A capture starts strictly above it. */
function queueHighWaterMark(): number {
	let highest = 0;
	for (const dir of ["pending", "done", "answers"]) {
		const path = join(QUEUE, dir);
		if (!existsSync(path)) continue;
		for (const name of readdirSync(path)) {
			const id = Number(name.replace(/\.json$/u, ""));
			if (Number.isInteger(id) && id > highest) highest = id;
		}
	}
	return highest;
}

const markPath = join(MARKS, `${projectId}.json`);

if (command === "mark") {
	const mark = queueHighWaterMark();
	mkdirSync(MARKS, { recursive: true });
	writeFileSync(markPath, `${JSON.stringify({ projectId, mark, markedAt: new Date().toISOString() }, null, "\t")}\n`);
	console.log(`mark ${mark} recorded for ${projectId} — seed the project now; everything above ${mark} is its traffic.`);
	process.exit(0);
}
if (command !== "record") {
	fail(`unknown command "${command}" — expected "mark" or "record"`);
}

if (!existsSync(markPath)) {
	fail(`no mark for ${projectId}. Run \`mark ${projectId}\` BEFORE seeding — without it a capture cannot know where this project's traffic begins, and would silently record the previous run.`);
}
const { mark } = JSON.parse(readFileSync(markPath, "utf8")) as { mark: number };

// 1. Reshape the queue slice into a capture directory.
const captureDir = mkdtempSync(join(tmpdir(), `hitl-capture-${projectId}-`));
const captureOut = execFileSync(
	"npx",
	["tsx", join(REPO, "scripts/hitl-queue-to-capture.mts"), "--out", captureDir, "--from", String(mark), "--queue", QUEUE],
	{ cwd: REPO, encoding: "utf8" },
);
console.log(captureOut.trim());
const captured = readdirSync(captureDir).filter((name) => name.endsWith(".json"));
if (captured.length === 0) {
	fail(`nothing above mark ${mark} — the drive never ran, or it ran before the mark was taken.`);
}

// 2. Distill it into scenario tracks.
const scenarioDir = join(REPO, "packages/llm-simulator/scenarios", projectId);
mkdirSync(scenarioDir, { recursive: true });
const runPath = join(scenarioDir, "perfect-run.json");
console.log(
	execFileSync("npx", ["tsx", join(REPO, "scripts/distill-capture.mts"), captureDir, "--out", runPath], {
		cwd: REPO,
		encoding: "utf8",
	}).trim(),
);
const script = JSON.parse(readFileSync(runPath, "utf8")) as { name?: string; tracks: unknown[] };
script.name = `${projectId} perfect run (HITL rig drive, requests ${mark + 1}-${queueHighWaterMark()})`;
writeFileSync(runPath, `${JSON.stringify(script, null, "\t")}\n`);

// 3. Provenance: which queue files this set was built from, so a later edit is visible as drift.
const sources: Record<string, string> = {};
for (const name of captured.sort()) {
	const id = Number(name.replace(/\.json$/u, ""));
	const answerPath = join(QUEUE, "answers", `${id}.json`);
	if (!existsSync(answerPath)) continue;
	sources[`queue/answers/${id}.json`] = `sha256:${createHash("sha256").update(readFileSync(answerPath)).digest("hex").slice(0, 16)}`;
}
writeFileSync(
	join(scenarioDir, "sources.json"),
	`${JSON.stringify(
		{
			drain: DRAIN,
			generatedAt: new Date().toISOString(),
			fromRequestId: mark + 1,
			pairs: captured.length,
			tracks: script.tracks.length,
			// A recording that has never been replayed is not a test. This starts FALSE and is flipped only by a
			// passing replay, so the existence of a scenario directory can never be mistaken for a working one —
			// live 2026-09-08: the first recorded project's replay failed on an environment check, the directory was
			// written anyway, and a resumable re-run would have skipped it as already done.
			replayVerified: false,
			sources,
		},
		null,
		"\t",
	)}\n`,
);

const verifyCommand = `NKLEIN_SIMFLOW_SCENARIO=${projectId} npx tsx scripts/verify-simulated-flow.mts`;
writeFileSync(
	join(scenarioDir, "README.md"),
	[
		`# ${projectId} — recorded scenario set`,
		"",
		`Recorded from a real HITL rig drive (requests ${mark + 1}+ of \`${QUEUE}\`), reshaped by`,
		"`scripts/hitl-record-project.mts`. Every turn here is a response a real model actually produced against the",
		"real runtime; nothing was authored to make the replay pass.",
		"",
		`- pairs captured: ${captured.length}`,
		`- distilled tracks: ${script.tracks.length}`,
		"",
		"## Replay",
		"",
		"```bash",
		verifyCommand,
		"```",
		"",
		"A track that has never been replayed is not a test. If this set stops passing, the runtime changed shape:",
		"fix the runtime or re-record the drive — do not hand-edit a track to make it pass.",
		"",
	].join("\n"),
);

console.log(`\nwrote ${scenarioDir}\n  perfect-run.json (${script.tracks.length} tracks)\n  sources.json (${captured.length} pairs)\n  README.md`);
console.log(`\nNOW PROVE IT REPLAYS:\n  ${verifyCommand}`);
