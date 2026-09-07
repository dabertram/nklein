/**
 * Dschinn REPLAY set — turn the HITL drive's raw material (Claude as the model, 2026-09-06/07) into the aimock
 * scenario set for dev-test project 36 (`36_dark_factory_dschinn_universal_agent`), so the full Dschinn progress
 * (spine S01–S51 + charter, slice 2 S52–S96) re-runs through the real runtime at memory speed with zero LLM compute
 * (David 2026-09-07: "make sure we're collecting everything needed for having aimock rerun the full Dschinn
 * progress").
 *
 * Sources (NKLEIN_HITL_DRAIN, default ~/.nklein/factory-drains/hitl-drain):
 *  - queue/answers/{17,19,20}.json — the slice-1 planner's add_task batches (17) and its sizing/coverage repairs
 *    (19/20: the last add_task per id wins) + answer 21's two add_dependency edges; 343.json — the slice-2 batch.
 *  - deliveries/S00…S96.json — every card's {files, predicted, final, review} exactly as the auto-driver delivered
 *    it (S00/S01 reconstructed from the project's git history — they predate the packaging script).
 * The two decompositions are folded into ONE plan (the harness seeds a project once): slice-2 cards depend on the
 * slice-1 cards whose files they import (derived from the deliveries), plus their declared edges.
 *
 * Wire truths honored (docs/dev/llm-simulator/README.md): decompose = class `any` keyed on a seed-only phrase;
 * per-card worker tracks keyed on `Implement spine card <title>` (unique per prompt, absent from seed + spec);
 * every ladder closes with a text turn + repeatLastTurn; review tracks cycleTurns with a non-empty summary.
 *
 * Usage: npx tsx scripts/generate-dschinn-scenario-set.mts   (writes perfect-run.json, README.md, sources.json)
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { compileScenarioScript } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript, ScenarioTrack, ScenarioTurn } from "../packages/llm-simulator/src/index.js";

const REPO = new URL("..", import.meta.url).pathname;
const DRAIN = process.env.NKLEIN_HITL_DRAIN?.trim() || join(homedir(), ".nklein", "factory-drains", "hitl-drain");
const SET_ID = "36_dark_factory_dschinn_universal_agent";
const PROJECT_DIR = join(REPO, "dev-test-projects", SET_ID);
const OUT_DIR = join(REPO, "packages", "llm-simulator", "scenarios", SET_ID);
const SLICE1_ANSWERS = [17, 19, 20];
const SLICE2_ANSWERS = [343];
/** Answer 21: the planner's two `add_dependency` calls after the coverage-gate charter card. */
const EXTRA_EDGES: ReadonlyArray<readonly [string, string]> = [
	["s00-charter", "s49"],
	["s00-charter", "s12"],
];
const SEED_NEEDLE = "a governed, deterministic control plane for an autonomous software-and-business factory";
/** Install-generated churn the early hand-driven captures carried (P0.LOCKFILECAPTURE drops it from captures today). */
const GENERATED_LOCKFILES = new Set(["package-lock.json"]);
const FLAKY_CARD_COUNT = 10;
/** The board renders long titles as an 80-char prefix + "…" (S40/S85), so the review needle keys on a shorter prefix. */
const REVIEW_TITLE_NEEDLE_CHARS = 60;
/** The planner's sizing cap on `filesLikelyTouched` (plan-task-validation.ts). */
const MAX_LIKELY_FILES = 3;
/** Root manifests / lockfiles / root configs — exempt from the write + boundary gates (work-package-card-shape.ts). */
function isCoarsePath(path: string): boolean {
	// Mirrors isCoarseScopePath (src/core/work-package-dispatch.ts): manifest/lockfile/tsconfig basenames anywhere,
	// tool configs only at the root.
	const basename = path.split("/").at(-1) ?? path;
	if (/^(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig(\..+)?\.json|biome\.json|\.gitignore|\.npmrc)$/u.test(basename)) return true;
	return !path.includes("/") && /^[\w.-]+\.config\.(c|m)?[jt]s$/u.test(basename);
}
const PROVENANCE = "HITL drive 2026-09-06/07 (Claude as the model; generate-dschinn-scenario-set.mts)";

interface AddTaskArgs {
	id: string;
	title: string;
	prompt: string;
	dependsOn?: string[];
	[key: string]: unknown;
}
interface DeliveryFile {
	path: string;
	content: string;
}
interface Delivery {
	files: DeliveryFile[];
	predicted: string;
	final: string;
	review: { summary: string; insight?: string };
}
interface Answer {
	content?: string;
	tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function deliveryFileFor(cardId: string): string {
	const match = /^s(\d{2})(?:-|$)/.exec(cardId);
	if (!match) throw new Error(`card id without a spine number: ${cardId}`);
	return join(DRAIN, "deliveries", `S${match[1]}.json`);
}

function workerNeedle(card: AddTaskArgs): string {
	const spine = `Implement spine card ${card.title}`;
	if (card.prompt.includes(spine)) return spine;
	// The charter card (coverage-gate addition) has its own opening line.
	const firstLine = card.prompt.split("\n")[0] ?? "";
	const needle = firstLine.slice(0, 60).trim();
	if (!needle) throw new Error(`no needle for ${card.id}`);
	return needle;
}

/** Relative imports of a delivered file, resolved to repo paths (`.ts` appended; `/index.ts` for directories). */
function importedPaths(file: DeliveryFile): string[] {
	const out = new Set<string>();
	const pattern = /(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"|import\s+"(\.[^"]+)"/g;
	for (const match of file.content.matchAll(pattern)) {
		const rel = match[1] ?? match[2];
		if (!rel) continue;
		const base = posix.normalize(posix.join(posix.dirname(file.path), rel));
		for (const candidate of [`${base}.ts`, posix.join(base, "index.ts"), base]) out.add(candidate);
	}
	return [...out];
}

function hasPath(graph: Map<string, Set<string>>, from: string, to: string, seen = new Set<string>()): boolean {
	if (from === to) return true;
	if (seen.has(from)) return false;
	seen.add(from);
	for (const next of graph.get(from) ?? []) if (hasPath(graph, next, to, seen)) return true;
	return false;
}

async function main(): Promise<void> {
	if (!existsSync(DRAIN)) throw new Error(`HITL drain not found at ${DRAIN} (set NKLEIN_HITL_DRAIN)`);
	const seedPrompt = await readFile(join(PROJECT_DIR, "user-prompt.txt"), "utf8");
	const spec = await readFile(join(PROJECT_DIR, "specification.md"), "utf8");
	if (!seedPrompt.includes(SEED_NEEDLE)) throw new Error("seed needle is not in user-prompt.txt");

	// 1. Cards: last add_task per id wins within a slice; slice order = the real drive's order.
	const sources: Record<string, string> = {};
	const cards: AddTaskArgs[] = [];
	const byId = new Map<string, AddTaskArgs>();
	for (const [answers, slice] of [
		[SLICE1_ANSWERS, "slice-1"],
		[SLICE2_ANSWERS, "slice-2"],
	] as const) {
		for (const n of answers) {
			const path = join(DRAIN, "queue", "answers", `${n}.json`);
			const raw = await readFile(path, "utf8");
			sources[`queue/answers/${n}.json`] = `${slice} sha256:${sha256(raw)}`;
			const answer = JSON.parse(raw) as Answer;
			for (const call of answer.tool_calls ?? []) {
				if (call.name !== "add_task") continue;
				const args = call.arguments as unknown as AddTaskArgs;
				if (!byId.has(args.id)) cards.push(args);
				byId.set(args.id, args);
			}
		}
	}
	const finalCards = cards.map((card) => byId.get(card.id) as AddTaskArgs);
	const index = new Map(finalCards.map((card, position) => [card.id, position] as const));

	// 2. Deliveries + path ownership (a path written by several cards is owned by each; edges only point BACK).
	const deliveries = new Map<string, Delivery>();
	const owners = new Map<string, string[]>();
	for (const card of finalCards) {
		const path = deliveryFileFor(card.id);
		const raw = await readFile(path, "utf8");
		sources[`deliveries/${posix.basename(path)}`] = `${card.id} sha256:${sha256(raw)}`;
		const delivery = JSON.parse(raw) as Delivery;
		if (card.id === "s01") {
			// The scaffold carries the lockfile the drive's first `npm install` generated (captured with S03): with it
			// every later placement runs `npm ci` against pinned integrity — the shape P1.NPMSEED's offline seed needs.
			const lockfile = (JSON.parse(await readFile(join(DRAIN, "deliveries", "S03.json"), "utf8")) as Delivery).files.find(
				(file) => file.path === "package-lock.json",
			);
			if (lockfile && !delivery.files.some((file) => file.path === lockfile.path)) {
				delivery.files.push(lockfile);
				delivery.final = `${delivery.final} package-lock.json pins the dependency set for \`npm ci\`.`;
			}
		}
		if (!delivery.files?.length || !delivery.final || !delivery.review?.summary) {
			throw new Error(`delivery for ${card.id} is incomplete`);
		}
		deliveries.set(card.id, delivery);
		for (const file of delivery.files) owners.set(file.path, [...(owners.get(file.path) ?? []), card.id]);
	}

	// 2b. The write scope the runtime enforces is `filesLikelyTouched`: it must cover every file the delivery writes
	// (run 4, 2026-09-07: S01's tsconfig.json was "outside this card's write scope" → blocked write → empty patch →
	// a no-op completion that left main at the fixture). COARSE paths (root manifests, lockfiles, root configs) are
	// exempt from both gates and do not count against the planner's 3-file sizing cap (run 5: "Task s01 touches 8
	// likely files") — so they stay out of the declared scope. The harness fixture's node:test starter is ignored by
	// S01's vitest.config.ts include pattern (`test/**/*.test.ts`), so nothing needs deleting.
	for (const card of finalCards) {
		const delivered = (deliveries.get(card.id)?.files ?? []).map((file) => file.path).filter((path) => !isCoarsePath(path));
		const declared = Array.isArray(card.filesLikelyTouched) ? (card.filesLikelyTouched as string[]) : [];
		card.filesLikelyTouched = [...new Set([...declared, ...delivered])];
		if (card.filesLikelyTouched.length > MAX_LIKELY_FILES) {
			throw new Error(`${card.id} declares ${card.filesLikelyTouched.length} likely files (cap ${MAX_LIKELY_FILES}): ${card.filesLikelyTouched.join(", ")}`);
		}
	}

	// 3. Edges: declared + the planner's add_dependency calls + import-derived (earlier owners only, acyclic).
	const edges = new Map<string, Set<string>>(finalCards.map((card) => [card.id, new Set(card.dependsOn ?? [])]));
	for (const [from, to] of EXTRA_EDGES) edges.get(from)?.add(to);
	let derived = 0;
	for (const card of finalCards) {
		const position = index.get(card.id) ?? 0;
		for (const file of deliveries.get(card.id)?.files ?? []) {
			for (const imported of importedPaths(file)) {
				for (const owner of owners.get(imported) ?? []) {
					if (owner === card.id || (index.get(owner) ?? Number.MAX_SAFE_INTEGER) >= position) continue;
					const set = edges.get(card.id) as Set<string>;
					if (set.has(owner) || hasPath(edges, owner, card.id)) continue;
					set.add(owner);
					derived += 1;
				}
			}
		}
	}
	for (const [from, targets] of edges) {
		for (const to of targets) if (!byId.has(to)) throw new Error(`${from} depends on unknown card ${to}`);
	}
	// Transitive reduction: an edge implied by a longer path says nothing new and only bloats the plan.
	let pruned = 0;
	for (const [from, targets] of edges) {
		for (const to of [...targets]) {
			const implied = [...targets].some((via) => via !== to && hasPath(edges, via, to));
			if (implied) {
				targets.delete(to);
				pruned += 1;
			}
		}
	}

	// 4. Needles: unique across every card prompt, absent from the seed prompt and the specification.
	const needles = new Map<string, string>();
	for (const card of finalCards) {
		const needle = workerNeedle(card);
		const hits = finalCards.filter((other) => other.prompt.includes(needle)).map((other) => other.id);
		if (hits.length !== 1 || hits[0] !== card.id) throw new Error(`needle "${needle}" hits ${hits.join(", ")}`);
		if (seedPrompt.includes(needle) || spec.includes(needle)) throw new Error(`needle "${needle}" leaks into the seed`);
		needles.set(card.id, needle);
	}
	// Review needles are `the card "<title>` (no closing quote: titles may contain quotes) — so no title may be a
	// prefix of another, or one review track would answer two cards.
	for (const card of finalCards) {
		const prefix = card.title.slice(0, REVIEW_TITLE_NEEDLE_CHARS);
		const clash = finalCards.find((other) => other.id !== card.id && other.title.startsWith(prefix));
		if (clash) throw new Error(`title "${card.title}" is a prefix of "${clash.title}"`);
	}
	for (const card of finalCards) if (card.prompt.includes(SEED_NEEDLE)) throw new Error(`seed needle leaks into ${card.id}`);

	// 5. Tracks.
	// ONE tool call per turn: the first harness run (2026-09-07) proved that only the FIRST call of a simulated
	// multi-call turn is executed (53 add_task calls in one turn → one update_focus_chain; the plan then failed the
	// coverage gate with a single card). The HITL model server returned OpenAI tool_calls arrays and the runtime ran
	// them all; the simulator transport does not — so every batch becomes a ladder of single-call turns.
	const toolCall = (call: { name: string; arguments: Record<string, unknown> }, content?: string): ScenarioTurn => ({
		behavior: { kind: "tool_calls", calls: [call], ...(content ? { content } : {}) },
	});
	const toolCalls = (
		calls: Array<{ name: string; arguments: Record<string, unknown> }>,
		content?: string,
	): ScenarioTurn[] => calls.map((call, position) => toolCall(call, position === 0 ? content : undefined));
	// The planner's BATCH form — `add_task({ tasks: [...] })` (incremental-dag-tools.ts accepts an array of task
	// objects) — keeps each slice to ONE single-call turn: the second harness run showed one add_task per turn
	// overflowing the simulated 65k window after ~65 cards, and the restart brief then leaked card needles.
	const addTaskCalls = (slice: AddTaskArgs[]) => [
		{
			name: "add_task",
			arguments: {
				tasks: slice.map((card) => ({ ...card, dependsOn: [...(edges.get(card.id) ?? [])].sort() })),
			} as Record<string, unknown>,
		},
	];
	const slice1 = finalCards.filter((card) => !/^s(5[2-9]|[6-9]\d)$/.test(card.id));
	const slice2 = finalCards.filter((card) => /^s(5[2-9]|[6-9]\d)$/.test(card.id));
	const decompose: ScenarioTrack = {
		id: "perfect-decompose",
		requestClass: "any",
		userMessageIncludes: SEED_NEEDLE,
		turns: [
			...toolCalls(
				[
					{
						name: "update_focus_chain",
						arguments: {
							name: "dschinn spine + slice 2",
							steps: [
								{ text: "Read specification.md completely", status: "done" },
								{ text: "Add the spine cards S01–S51 + the charter (§2 first vertical slice)", status: "in_progress" },
								{ text: "Add the slice-2 cards S52–S96 (§M breadth on the proven spine)", status: "pending" },
								{ text: "Submit the graph with decompose_project", status: "pending" },
							],
						},
					},
					...addTaskCalls(slice1),
				],
				`Adding the ${slice1.length} spine cards (S01–S51 + the charter) exactly as specification.md §2 prescribes, dependency-ordered.`,
			),
			...toolCalls(
				addTaskCalls(slice2),
				`Slice 2 per specification.md §M: adding the ${slice2.length} cards S52–S96 (seams first, then one capability family per layer), each depending on the spine modules it imports.`,
			),
			toolCall({ name: "decompose_project", arguments: {} }, "Submitting the accumulated graph."),
		],
		repeatLastTurn: true,
		provenance: `${PROVENANCE}: answers 17/19/20/21 (spine) + 343/345 (slice 2), folded into one plan`,
	};
	const workers: ScenarioTrack[] = finalCards.map((card) => {
		const delivery = deliveries.get(card.id) as Delivery;
		const files = delivery.files.map((file) => file.path).join(", ");
		return {
			id: `perfect-worker-${card.id}`,
			requestClass: "worker",
			userMessageIncludes: needles.get(card.id) as string,
			turns: [
				...toolCalls(
					[
						{
							name: "update_focus_chain",
							arguments: {
								name: card.id,
								steps: [
									{ text: "Refine: confirm scaffold present", status: "done" },
									{ text: `Write ${files}`, status: "in_progress" },
									{ text: "npm test, typecheck", status: "pending" },
									{ text: "predict_output and finish", status: "pending" },
								],
							},
						},
						{
							name: "begin_implementation",
							arguments: { refinementNotes: `Deliver ${card.title} per its spec block within the write scope.` },
						},
						{ name: "write_files", arguments: { files: delivery.files.filter((file) => !GENERATED_LOCKFILES.has(file.path)) } },
						{ name: "run_commands", arguments: { commands: ["npm test 2>&1 | tail -n 12"] } },
					],
					`Refinement: scaffold present. Delivering ${card.title} within scope, test-first, then running the acceptance check.`,
				),
				...toolCalls(
					[
						{
							name: "run_commands",
							arguments: { commands: ["npm run typecheck 2>&1 | tail -n 4; echo typecheck-exit=$?"] },
						},
						{
							name: "update_focus_chain",
							arguments: {
								name: card.id,
								steps: [
									{ text: "Refine: confirm scaffold present", status: "done" },
									{ text: "Write files", status: "done" },
									{ text: "npm test, typecheck", status: "done" },
									{ text: "predict_output and finish", status: "in_progress" },
								],
							},
						},
						{ name: "predict_output", arguments: { predicted: delivery.predicted } },
					],
					"Acceptance green; running the typecheck and recording the prediction.",
				),
				{ behavior: { kind: "text", content: delivery.final } },
			],
			repeatLastTurn: true,
			provenance: `${PROVENANCE}: deliveries/${posix.basename(deliveryFileFor(card.id))}`,
		};
	});
	const reviews: ScenarioTrack[] = finalCards.map((card) => {
		const review = (deliveries.get(card.id) as Delivery).review;
		return {
			id: `perfect-review-${card.id}`,
			requestClass: "review",
			userMessageIncludes: `the card "${card.title.slice(0, REVIEW_TITLE_NEEDLE_CHARS)}`,
			turns: [
				toolCall({
						name: "submit_review",
						arguments: { verdict: "approve", summary: review.summary, ...(review.insight ? { insight: review.insight } : {}) },
				}),
				{ behavior: { kind: "text", content: "Review submitted." } },
			],
			cycleTurns: true,
			provenance: `${PROVENANCE}: the reviewer verdict the auto-driver submitted for ${card.id}`,
		};
	});
	const chat: ScenarioTrack = {
		id: "chat-status",
		requestClass: "chat",
		turns: [
			{
				behavior: {
					kind: "text",
					content:
						"Dschinn is progressing card by card: the deterministic spine (S01–S51 + charter) first, then slice 2's breadth on the proven spine (S52–S96). Ask about any specific card for details.",
				},
			},
		],
		repeatLastTurn: true,
		provenance: PROVENANCE,
	};
	const fallback: ScenarioTrack = {
		id: "any-fallback",
		requestClass: "any",
		turns: [{ behavior: { kind: "text", content: "Acknowledged. Proceeding as instructed." } }],
		repeatLastTurn: true,
		provenance: PROVENANCE,
	};
	const script: ScenarioScript = {
		name: `${SET_ID} perfect run (HITL replay: spine S01–S51 + charter + slice 2 S52–S96)`,
		seed: 136,
		tracks: [decompose, ...workers, ...reviews, chat, fallback],
	};
	const compiled = compileScenarioScript(script);
	const fixtureCount = Array.isArray(compiled) ? compiled.length : ((compiled as { fixtures?: unknown[] }).fixtures?.length ?? 0);

	// Flaky variant (the structural guard expects one per set): the first FLAKY_CARD_COUNT spine cards — a valid
	// prefix of the DAG — with the five failure-catalog modes injected before the first worker turn, then the
	// unchanged recovery ladder. Mirrors generate-scenario-sets.mts so the replay exercises the same transport paths.
	const prefix = finalCards.slice(0, FLAKY_CARD_COUNT);
	const prefixIds = new Set(prefix.map((card) => card.id));
	const prefixCalls = [
		{
			name: "add_task",
			arguments: {
				tasks: prefix.map((card) => ({
					...card,
					dependsOn: [...(edges.get(card.id) ?? [])].filter((dep) => prefixIds.has(dep)).sort(),
				})),
			} as Record<string, unknown>,
		},
	];
	const flakyDecompose: ScenarioTrack = {
		...decompose,
		turns: [
			...toolCalls(prefixCalls, `Adding the first ${prefix.length} spine cards (flaky replay prefix).`),
			toolCall({ name: "decompose_project", arguments: {} }, "Submitting the accumulated graph."),
		],
		provenance: `${PROVENANCE}: the first ${prefix.length} spine cards of the perfect plan`,
	};
	const failureKinds = ["t-429-rate", "c-empty-completion", "c-reasoning-only", "t-sse-stall-mid", "c-trunc-tool-json"] as const;
	const flakyWorkers: ScenarioTrack[] = prefix.map((card, position) => {
		const base = workers.find((track) => track.id === `perfect-worker-${card.id}`) as ScenarioTrack;
		const failure = position >= 1 && position - 1 < failureKinds.length ? failureKinds[position - 1] : undefined;
		if (!failure) return base;
		const failureTurn: ScenarioTurn =
			failure === "t-429-rate"
				? { behavior: { kind: "http_error", status: 429, message: "simulated rate limit", retryAfterSeconds: 2 } }
				: failure === "c-empty-completion"
					? { behavior: { kind: "empty_completion" } }
					: failure === "c-reasoning-only"
						? { behavior: { kind: "text", content: "", reasoning: `Thinking through "${card.title}" step by step before writing files…` } }
						: failure === "t-sse-stall-mid"
							? { behavior: { kind: "stall", ttftMs: 8_000 } }
							: {
									behavior: {
										kind: "tool_calls",
										calls: [{ name: "write_files", arguments: { files: `[{"path":"src/truncated.ts","content":"export const truncated = ` } }],
									},
								};
		return {
			...base,
			id: `flaky-worker-${card.id}`,
			turns: [failureTurn, ...base.turns],
			provenance: `${base.provenance} — ${failure} then recovery (failure-catalog.md)`,
		};
	});
	const flakyReviews = reviews.filter((track) => prefix.some((card) => track.id === `perfect-review-${card.id}`));
	const flaky: ScenarioScript = {
		name: `${SET_ID} flaky run (HITL replay prefix S01–S${String(prefix.length).padStart(2, "0")} with catalog failures)`,
		seed: 236,
		tracks: [flakyDecompose, ...flakyWorkers, ...flakyReviews, chat, fallback],
	};
	compileScenarioScript(flaky);

	await mkdir(OUT_DIR, { recursive: true });
	const json = `${JSON.stringify(script, null, "\t")}\n`;
	await writeFile(join(OUT_DIR, "perfect-run.json"), json, "utf8");
	await writeFile(join(OUT_DIR, "flaky-run.json"), `${JSON.stringify(flaky, null, "\t")}\n`, "utf8");
	await writeFile(
		join(OUT_DIR, "sources.json"),
		`${JSON.stringify({ drain: DRAIN, generatedAt: new Date().toISOString(), cards: finalCards.length, derivedImportEdges: derived, prunedTransitiveEdges: pruned, sources }, null, "\t")}\n`,
		"utf8",
	);
	const totalEdges = [...edges.values()].reduce((sum, set) => sum + set.size, 0);
	await writeFile(
		join(OUT_DIR, "README.md"),
		`# ${SET_ID} — Dschinn HITL replay

Generated by \`scripts/generate-dschinn-scenario-set.mts\` from the HITL drive of 2026-09-06/07 (Claude answered every
model request through the HITL model server; the auto-driver delivered pre-verified files). This set replays the FULL
Dschinn progress through the real runtime: one decompose (${finalCards.length} cards: spine S01–S51 + the charter,
slice 2 S52–S96; ${totalEdges} dependency edges of which ${derived} are import-derived cross-slice edges), one
worker track and one review track per card, a chat track and an any-class fallback (${script.tracks.length} tracks,
${fixtureCount} compiled fixtures).

- **perfect-run.json** — the replay. Worker needle: \`Implement spine card <title>\` (the charter: its opening line);
  review needle: \`the card "<first 60 title chars>\` (the board truncates long titles); decompose: class \`any\` keyed on
  the seed-only phrase. Every turn carries ONE tool call (the simulator transport executes only the first call of a turn — P2.SIMMULTICALL);
  the plan rides the planner's batch form \`add_task({ tasks })\`, one call per slice, so the planning transcript stays small.
- **flaky-run.json** — the first ${FLAKY_CARD_COUNT} spine cards with the five failure-catalog modes (429, empty completion,
  reasoning-only, SSE stall, truncated tool JSON) injected before the first worker turn, then the same recovery ladder.
- **sources.json** — provenance: which drain answer/delivery each track came from (sha256-prefixed).

Run: \`HOME=$(mktemp -d /tmp/nklein-simflow-XXXX) NKLEIN_SIMFLOW_SCENARIO=36 NKLEIN_SIMFLOW_TIMEOUT_MS=14400000 npx tsx scripts/verify-simulated-flow.mts\`

Caveat (2026-09-07): the harness keeps sandboxes OFFLINE, and Dschinn's acceptance (\`vitest run\`) needs installed
dependencies (vitest, zod, typescript). Without a seeded npm cache the acceptance is red on the base tree too, so
deliveries proceed on the reviewer's verdict under the pre-existing-breakage waiver; prove the code afterwards with
\`npm ci && npx vitest run && npx tsc --noEmit\` on the drained repo (expected: 97 test files / 222 tests, tsc clean).
A truthful in-sandbox acceptance needs the warm npm-cache seed mechanism (todo P1.NPMSEED).
`,
		"utf8",
	);
	console.log(
		`${SET_ID}: ${finalCards.length} cards (${slice1.length} spine + ${slice2.length} slice-2), ${totalEdges} edges (${derived} import-derived, ${pruned} transitive pruned), ${script.tracks.length} tracks, ${fixtureCount} fixtures, ${(json.length / 1024).toFixed(0)} KB → ${OUT_DIR}`,
	);
}

await main();
