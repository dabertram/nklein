/**
 * Drive a LIST of dev-test projects through the rig and record each one as a committed scenario set.
 *
 * ── WHY ──
 * Recording one project is four steps (mark, seed, drain, record) and they must happen in that order, with the
 * mark taken BEFORE the seed or the capture silently swallows the previous project's traffic. Doing that forty
 * times by hand is forty chances to get the order wrong, and the failure is invisible: a scenario set that replays
 * the wrong run under the right name is green and lying.
 *
 * So the sequence is the script. It is also RESUMABLE — a project whose scenario set already exists is skipped —
 * which matters because a run of forty projects takes many hours and will be interrupted.
 *
 * It does NOT answer the model queue. Something else has to be sitting in the model seat (see
 * `scripts/hitl-next-request.sh`); this only sets projects up, waits for them to drain, and records what happened.
 *
 * Usage:
 *   npx tsx scripts/hitl-record-run.mts <projectId...> [--max-wait-ms N] [--state <file>] [--base <url>]
 *   npx tsx scripts/hitl-record-run.mts --all-new           # every project from 37 onward, in order
 *   npx tsx scripts/hitl-record-run.mts --all-new --dry-run # print the plan and change nothing
 *   npx tsx scripts/hitl-record-run.mts --all-new --repair  # rebuild unverified recordings from the queue, no re-drive
 *
 * `--dry-run` exists because I ran this to check which projects it would pick and it seeded one instead, which
 * then competed for the rig's single endpoint with the drive already in flight. A script whose first action is
 * expensive and irreversible needs a way to be asked what it would do.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(new URL("..", import.meta.url).pathname);
const SCENARIOS = join(REPO, "packages/llm-simulator/scenarios");

function argOf(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Per-project deadline. 90 minutes was sized for a fast endpoint and is far too short for this rig.
 *
 * Live 2026-09-09: project 41 decomposed into 8 cards and was driving them properly — 2 completed, 6 in review —
 * when the rail hit exactly this deadline at 90 minutes and exited. The driver then captured the queue slice and
 * the replay failed `left cards undrained`, because the recording had been taken MID-FLIGHT. The runtime carried
 * on working the abandoned project afterwards, competing with the next one for the same serial endpoint.
 *
 * The arithmetic: the model seat answers at roughly 3 minutes a turn, and a card needs implementation turns plus
 * a review round, so an 8-card project is several hours. A deadline shorter than the work does not bound a
 * failure, it manufactures one — and it manufactures the WORST kind, a partial recording that looks like a real
 * one. The stall watchdog (45 min of no movement) is what actually catches a dead drive; this only needs to be
 * generous enough not to cut a live one short.
 */
const maxWaitMs = Number(argOf("--max-wait-ms") ?? 14_400_000);
const base = argOf("--base") ?? "http://127.0.0.1:3503";
const statePath = resolve(argOf("--state") ?? join(REPO, ".nklein-record-run.json"));

function selectProjects(): string[] {
	if (process.argv.includes("--all-new")) {
		return readdirSync(join(REPO, "dev-test-projects"))
			.filter((name) => /^(3[7-9]|[4-7]\d)_/u.test(name))
			.sort();
	}
	return process.argv.slice(2).filter((value) => !value.startsWith("--") && !/^\d+$/u.test(value) && !value.startsWith("http"));
}

/** Run a command to completion, streaming nothing; returns its exit code and tail of output. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; tail: string }> {
	return new Promise((resolveRun) => {
		const child = spawn(command, args, { cwd: REPO, env: { ...process.env, ...env } });
		let output = "";
		const collect = (chunk: Buffer) => {
			output += chunk.toString();
			if (output.length > 20000) output = output.slice(-20000);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("close", (code) => resolveRun({ code: code ?? 1, tail: output.split("\n").slice(-25).join("\n") }));
	});
}

/**
 * A recording counts as done only when it has REPLAYED.
 *
 * Live 2026-09-08: the first project recorded cleanly and its replay failed on an environment check. The scenario
 * directory existed, so a resumed run would have skipped it as finished and the batch would have quietly shipped a
 * set nobody had ever replayed. Existence of a file is not evidence that it works.
 */
function isVerifiedRecording(projectId: string): boolean {
	try {
		const sources = JSON.parse(readFileSync(join(SCENARIOS, projectId, "sources.json"), "utf8"));
		return existsSync(join(SCENARIOS, projectId, "perfect-run.json")) && sources.replayVerified === true;
	} catch {
		return false;
	}
}

function markReplayVerified(projectId: string): void {
	try {
		const path = join(SCENARIOS, projectId, "sources.json");
		const sources = JSON.parse(readFileSync(path, "utf8"));
		writeFileSync(path, `${JSON.stringify({ ...sources, replayVerified: true }, null, "\t")}\n`);
	} catch {
		// The recording still stands; it simply will not be skipped next time, which is the safe direction.
	}
}

interface ProjectResult {
	projectId: string;
	/** `retrying` is deliberately NOT a failure: the rig never drove the project, so nothing was measured. */
	status: "skipped" | "recorded" | "failed" | "retrying";
	detail: string;
	at: string;
}

const results: ProjectResult[] = existsSync(statePath)
	? (JSON.parse(readFileSync(statePath, "utf8")).results ?? [])
	: [];

function saveState(current?: string): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify({ updatedAt: new Date().toISOString(), current, results }, null, "\t")}\n`);
}

function note(result: ProjectResult): void {
	results.push(result);
	saveState();
	console.log(`[${result.status}] ${result.projectId}: ${result.detail}`);
}

const projects = selectProjects();
if (projects.length === 0) {
	console.error("Usage: npx tsx scripts/hitl-record-run.mts <projectId...> | --all-new [--dry-run]");
	process.exit(1);
}

if (process.argv.includes("--dry-run")) {
	console.log(`would record ${projects.length} project(s), state in ${statePath}:`);
	for (const projectId of projects) {
		console.log(`  ${isVerifiedRecording(projectId) ? "skip" : "run "} ${projectId}`);
	}
	process.exit(0);
}

/**
 * `--repair`: rebuild a recording from the queue WITHOUT re-driving the project.
 *
 * A replay failure is not proof that the drive was bad. Live 2026-09-10, projects 40 and 41 were both marked
 * `failed` at the replay step because their captures were 26% and 46% `main-branch-custodian` traffic — a defect in
 * the CAPTURE, fixed hours later, by which time both verdicts were terminal and the only route back was a two-to
 * three-hour re-drive each. The drive's traffic was still sitting in the queue the whole time.
 *
 * So: whenever the capture logic changes, every unverified recording can be rebuilt and re-proved for the cost of a
 * replay. This mode does exactly that and touches neither the rig nor the board, so it is safe to run while a drive
 * is in flight. It cannot help a project that was never driven — with no traffic there is nothing to rebuild.
 *
 * ── WHAT IT DID NOT FIX ──
 * Tried on 40 and 41 the same day. Both rebuilt cleanly — bounded windows, custodian traffic gone, 43 and 48 tracks
 * of nothing but their own cards — and 40 still replayed to `left cards undrained (planning: 1)`. So a clean capture
 * of those two drives is still not a replayable one, and the reason is NOT visible in the track structure: every
 * signal that looked diagnostic (a prose turn that calls no tool, more than one `decompose_project`) is present in
 * all six sets that DO replay, 39 included. Both projects were driven across two days with repeated re-decomposition
 * — 40's decompose session alone spans request ids 951 to 1514 — and the working assumption is that the drive itself,
 * not its capture, is what cannot be reproduced. They are queued for a clean re-drive.
 */
async function repairUnverified(projectIds: readonly string[]): Promise<void> {
	const repairable = projectIds.filter(
		(projectId) => !isVerifiedRecording(projectId) && existsSync(join(SCENARIOS, projectId, "perfect-run.json")),
	);
	console.log(
		repairable.length > 0
			? `repairing ${repairable.length} unverified recording(s) from the queue — no project is re-driven:\n  ${repairable.join("\n  ")}`
			: "nothing to repair: every recording on disk has already replayed",
	);
	for (const projectId of repairable) {
		console.log(`\n=== ${projectId} (repair) ===`);
		const recorded = await run("npx", ["tsx", "scripts/hitl-record-project.mts", "record", projectId]);
		if (recorded.code !== 0) {
			note({ projectId, status: "failed", detail: `repair record failed: ${recorded.tail}`, at: new Date().toISOString() });
			continue;
		}
		const replayHome = mkdtempSync(join(tmpdir(), `nklein-simflow-${projectId}-`));
		const replayed = await run("npx", ["tsx", "scripts/verify-simulated-flow.mts"], {
			NKLEIN_SIMFLOW_SCENARIO: projectId,
			HOME: replayHome,
		});
		if (replayed.code === 0) {
			markReplayVerified(projectId);
		}
		note({
			projectId,
			status: replayed.code === 0 ? "recorded" : "failed",
			detail:
				replayed.code === 0
					? "repaired from the queue and replayed — no re-drive"
					: `repair replay still failed: ${replayed.tail}`,
			at: new Date().toISOString(),
		});
	}
	saveState();
}

if (process.argv.includes("--repair")) {
	await repairUnverified(projects);
	process.exit(0);
}

/**
 * Refuse to seed onto a busy rig.
 *
 * The endpoint serves one task at a time, so seeding a second project does not add throughput — it interleaves two
 * drives on one queue and makes BOTH recordings incoherent, since a capture is a slice of that queue by request id.
 * Live 2026-09-08: exactly this happened and had to be unwound by hand.
 */
async function liveCardsElsewhere(): Promise<string[]> {
	try {
		const listed = await fetch(`${base}/api/trpc/projects.list?batch=1`).then((response) => response.json());
		const workspaces = listed[0]?.result?.data?.projects ?? [];
		const busy: string[] = [];
		for (const workspace of workspaces) {
			const state = await fetch(
				`${base}/api/trpc/workspace.getState?workspaceId=${encodeURIComponent(workspace.id)}`,
				{ headers: { "x-nklein-workspace-id": workspace.id } },
			).then((response) => response.json());
			const columns = state?.result?.data?.board?.columns ?? [];
			const live = columns
				.filter((column: { id: string }) => !["completed", "trash", "backlog"].includes(column.id))
				.flatMap((column: { cards: unknown[] }) => column.cards);
			if (live.length > 0) {
				busy.push(`${workspace.id} (${live.length} live card(s))`);
			}
		}
		return busy;
	} catch {
		return [];
	}
}

const busy = await liveCardsElsewhere();
if (busy.length > 0 && !process.argv.includes("--force")) {
	console.error(
		`refusing to start: the rig already has live cards, and its endpoint serves one task at a time, so a second drive would interleave with the first and make BOTH recordings incoherent:\n  ${busy.join("\n  ")}\n\nWait for them, abandon them (scripts/hitl-abandon-run.mts), or pass --force.`,
	);
	process.exit(1);
}

// Preflight. Cheaper than discovering it project by project, and the failure mode it prevents is the whole list
// being marked failed by an unreachable socket (see the rail-exit guard below).
try {
	const health = await fetch(`${base}/api/trpc/runtime.getConfig?input=${encodeURIComponent("{}")}`);
	if (!health.ok && health.status >= 500) {
		throw new Error(`runtime responded ${health.status}`);
	}
} catch (error) {
	console.error(
		`the runtime at ${base} is not reachable (${error instanceof Error ? error.message : String(error)}).\n` +
			"Start it before recording — otherwise every project is marked failed by a socket error that says nothing about it.",
	);
	process.exit(1);
}

console.log(`recording ${projects.length} project(s), state in ${statePath}`);

/**
 * A project the rig never actually drove is NOT a result. Live 2026-09-08: project 39 was filed as `failed` with
 * "captured 0 request/answer pair(s)" while six of its cards sat untouched in Planning — the rail had exited on
 * the seed card alone and the drive never happened. Recording that as a failure would put a project in the "the
 * model did badly" column that no model was ever asked about, and would quietly cost one of the forty.
 *
 * So a no-traffic drive is retried ONCE, at the end of the run (by then whatever was occupying the single serial
 * endpoint has finished — the usual cause). A second empty drive is a real failure and is reported as one.
 */
const NO_TRAFFIC = /captured 0 request\/answer pair/u;
const retriedProjectIds = new Set<string>();
const queue = [...projects];

for (let index = 0; index < queue.length; index += 1) {
	const projectId = queue[index] as string;
	if (isVerifiedRecording(projectId)) {
		note({ projectId, status: "skipped", detail: "already recorded and replayed", at: new Date().toISOString() });
		continue;
	}
	saveState(projectId);
	console.log(`\n=== ${projectId} ===`);

	// 1. The mark MUST be taken before the seed. `record` refuses without it rather than guessing.
	const marked = await run("npx", ["tsx", "scripts/hitl-record-project.mts", "mark", projectId]);
	if (marked.code !== 0) {
		note({ projectId, status: "failed", detail: `mark failed: ${marked.tail}`, at: new Date().toISOString() });
		continue;
	}

	// 2. Seed and drain. The rail owns the deadline and the settle rules; it exits when the board stops moving.
	const drained = await run(
		"npx",
		[
			"tsx", "scripts/dev-test-rail.mts",
			"--projects", projectId,
			"--model", "claude-hitl",
			"--endpoint", "http://127.0.0.1:8095/v1",
			"--concurrency", "1",
			"--max-wait-ms", String(maxWaitMs),
		],
		{ NKLEIN_VERIFY_BASE_URL: base },
	);
	// A rail that could not REACH the runtime says nothing about the project. Live 2026-09-09: the driver was
	// restarted a few seconds before the runtime finished booting, and it marched through all 38 remaining
	// projects in seconds, marking every one `failed` with `TRPCClientError: fetch failed`. Thirty-eight
	// projects burned by one unreachable socket — and `failed` is terminal here, so a later run would skip
	// none of them but the record would be a lie about every one.
	//
	// An unreachable rig is fatal to the RUN, not to the project: stop immediately, say so, and leave the
	// remaining projects untouched so the next run picks them up cleanly.
	if (/fetch failed|ECONNREFUSED|TRPCClientError/u.test(drained.tail)) {
		note({
			projectId,
			status: "retrying",
			detail: "the rig was unreachable (fetch failed) — this says nothing about the project. Aborting the run; nothing else was attempted.",
			at: new Date().toISOString(),
		});
		console.error(
			`\nABORTING: the runtime at ${base} is not reachable. Start it, then re-run — no further projects were attempted.`,
		);
		break;
	}
	// Exit 3 is the rail's STALLED signal: the drive stopped moving because the model seat went quiet, so whatever
	// traffic it managed is a stub, not a result. Recording it produces a scenario set that replays one card and
	// fails — which is how projects 39 and 40 were each burned twice on 2026-09-08 before this existed.
	if (drained.code === 3) {
		if (!retriedProjectIds.has(projectId)) {
			retriedProjectIds.add(projectId);
			queue.push(projectId);
			note({
				projectId,
				status: "retrying",
				detail: "the drive STALLED — the model seat stopped answering, so nothing was measured. Re-queued once for the end of the run.",
				at: new Date().toISOString(),
			});
			continue;
		}
		note({ projectId, status: "failed", detail: `stalled twice: ${drained.tail}`, at: new Date().toISOString() });
		continue;
	}
	if (drained.code !== 0) {
		note({ projectId, status: "failed", detail: `rail exited ${drained.code}: ${drained.tail}`, at: new Date().toISOString() });
		continue;
	}

	// 3. Reshape the queue slice into a scenario set.
	const recorded = await run("npx", ["tsx", "scripts/hitl-record-project.mts", "record", projectId]);
	if (recorded.code !== 0) {
		if (NO_TRAFFIC.test(recorded.tail) && !retriedProjectIds.has(projectId)) {
			retriedProjectIds.add(projectId);
			queue.push(projectId);
			note({
				projectId,
				status: "retrying",
				detail: "the drive produced NO model traffic — the rig never drove it, so this is not a result. Re-queued once for the end of the run.",
				at: new Date().toISOString(),
			});
			continue;
		}
		note({ projectId, status: "failed", detail: `record failed: ${recorded.tail}`, at: new Date().toISOString() });
		continue;
	}

	// 4. A recording that has never been replayed is not a test. Prove it replays before calling it done.
	// The harness REFUSES to run against the real HOME — it writes runtime state, and a dev-test replay must not
	// touch the operator's. Give it a throwaway one; forgetting this failed the first recording of the batch.
	const replayHome = mkdtempSync(join(tmpdir(), `nklein-simflow-${projectId}-`));
	const replayed = await run("npx", ["tsx", "scripts/verify-simulated-flow.mts"], {
		NKLEIN_SIMFLOW_SCENARIO: projectId,
		HOME: replayHome,
	});
	if (replayed.code === 0) {
		markReplayVerified(projectId);
		note({ projectId, status: "recorded", detail: "recorded and replayed", at: new Date().toISOString() });
		continue;
	}

	/**
	 * A replay failure earns ONE clean re-drive, queued for the end of the run.
	 *
	 * Unlike a stall or an empty drive, this project WAS measured — but what it measured can be the drive's mess
	 * rather than the project's difficulty. Live 2026-09-10: projects 40 and 41 both failed here, and rebuilding
	 * their captures from the queue (bounded window, custodian traffic excluded, nothing foreign left) did not
	 * help. Both had been driven across two days with repeated re-decomposition — 40's decompose session alone
	 * spans request ids 951 to 1514 — so what could not be replayed was the DRIVE, and the only repair is to drive
	 * it again from a clean board.
	 *
	 * Without this the run ends, says "failed: 40, 41", and waits for a human to start a second pass. It queues at
	 * the END so it costs the batch nothing until every fresh project has had its turn, and `retriedProjectIds`
	 * bounds it to one attempt — a project that fails its re-drive is a real failure and is reported as one.
	 */
	if (!retriedProjectIds.has(projectId)) {
		retriedProjectIds.add(projectId);
		queue.push(projectId);
		note({
			projectId,
			status: "retrying",
			detail: `replay failed, so the recording is unusable; re-driving once from a clean board at the end of the run: ${replayed.tail}`,
			at: new Date().toISOString(),
		});
		continue;
	}
	note({
		projectId,
		status: "failed",
		detail: `replay failed after a clean re-drive: ${replayed.tail}`,
		at: new Date().toISOString(),
	});
}

saveState();
// A project's LAST note is its outcome — an earlier `retrying` is superseded by whatever the retry produced.
const outcomeByProjectId = new Map(results.map((result) => [result.projectId, result]));
const outcomes = [...outcomeByProjectId.values()];
const recordedCount = outcomes.filter((result) => result.status === "recorded").length;
const failed = outcomes.filter((result) => result.status === "failed");
const retried = [...new Set(results.filter((result) => result.status === "retrying").map((r) => r.projectId))];
console.log(
	`\ndone: ${recordedCount} recorded, ${failed.length} failed, ${outcomes.length - recordedCount - failed.length} skipped`,
);
if (failed.length > 0) {
	console.log(`failed: ${failed.map((result) => result.projectId).join(", ")}`);
}
if (retried.length > 0) {
	console.log(`re-driven after producing no model traffic: ${retried.join(", ")}`);
}
