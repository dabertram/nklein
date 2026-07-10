/**
 * §13f scenario-set GENERATOR — emit extensive mock-LLM scenario sets (perfect + flaky) for the lower-20
 * dev-test-projects into packages/llm-simulator/scenarios/<project>/. Claude-authored set 01 is the hand-crafted
 * deep baseline; this generator scales the same SHAPE to 02–20 deterministically (seeded), to be hand-polished
 * selectively later (David's directive 2026-07-10: generator first — agents hit the session limit mid-authoring).
 *
 * Encodes the live wire truths from the fast-path bring-up (see packages/llm-simulator/test/request-classifier.test.ts):
 *  - decompose tracks are requestClass "any" + a SEED-ONLY needle (the "I want to build a real …" product phrase):
 *    a plan seed is textually identical to a worker card, so there is no universal decompose signal;
 *  - worker/review tracks are PER-CARD (aimock sequenceIndex counts per-fixture occurrences, not per-session);
 *  - submit_review carries a non-empty `summary`; every tool ladder closes with a TEXT turn; repeatLastTurn
 *    everywhere so redrives/nudges never strict-miss;
 *  - each set ends with an any-class fallback track.
 *
 * Generated card content is deliberately ZERO-DEPENDENCY ESM JavaScript verified by `node --test` (via each
 * project's `npm test`), so acceptance runs green offline with no npm install — machinery first, domain depth via
 * hand-polish. Usage:  npx tsx scripts/generate-scenario-sets.mts [NN…]   (default 02…20)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { compileScenarioScript } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript, ScenarioTrack, ScenarioTurn } from "../packages/llm-simulator/src/index.js";
import { createSeededRng } from "../packages/llm-simulator/src/scenario/seeded-rng.js";

const REPO = new URL("..", import.meta.url).pathname;
const PROJECTS_DIR = join(REPO, "dev-test-projects");
const SCENARIOS_DIR = join(REPO, "packages", "llm-simulator", "scenarios");
const MAX_CARDS = 50;

interface ProjectInput {
	dir: string;
	id: string;
	title: string;
	acceptanceCommand: string;
	tier: string;
	userPrompt: string;
	spec: string;
}

interface CardPlan {
	id: string;
	title: string;
	prompt: string;
	dependsOn: string[];
	complexity: number;
	filesLikelyTouched: string[];
	moduleSlug: string;
	conceptTitle: string;
}

// ---------------------------------------------------------------------------
// Spec harvesting
// ---------------------------------------------------------------------------

function sectionBullets(spec: string, header: string): string[] {
	const lines = spec.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`## ${header}`));
	if (start < 0) return [];
	const bullets: string[] = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index] as string;
		if (line.startsWith("## ")) break;
		if (line.startsWith("- ")) bullets.push(line.slice(2).trim());
	}
	return bullets;
}

/** "## E2. The hardest technical seam #1 — the 4-axis …" → "4-axis …" style extra card concepts. */
function seamConcepts(spec: string): string[] {
	const concepts: string[] = [];
	for (const line of spec.split("\n")) {
		const match = /^## E\d+\.\s+(.*)$/.exec(line);
		if (!match) continue;
		const raw = (match[1] as string).trim();
		const dashSplit = raw.split(/\s+[—-]\s+/);
		const concept = (dashSplit.length > 1 ? dashSplit.slice(1).join(" — ") : raw).trim();
		if (/why this is the right shape|research-grounded/i.test(concept)) continue;
		concepts.push(concept);
	}
	return concepts;
}

function expectedCardCount(spec: string, scopeBullets: number): number {
	const match = /Expected decomposition size:\s*(\d+)\s*-\s*(\d+)/.exec(spec);
	if (match) return Math.min(Number(match[2]), MAX_CARDS);
	return Math.min(Math.max(scopeBullets * 3, 18), MAX_CARDS);
}

function decomposeNeedle(userPrompt: string): string {
	const match = /I want to build a real (.+?), not a fake MVP/.exec(userPrompt);
	if (!match) throw new Error("user-prompt.txt does not match the seed template");
	return `real ${(match[1] as string).trim()}, not a fake MVP`;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function condenseTitle(bullet: string): string {
	// First clause, parentheticals stripped, capped for card-title use.
	const clause = ((bullet.split(/[.;:]/)[0] as string) ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
	// Word-capped AND char-capped: !Klein clamps board titles at 80 chars (task-title.ts) and the REVIEW seed
	// quotes the CLAMPED title — a generated title that exceeds the clamp can never match its review needle.
	let words = clause.split(/\s+/).slice(0, 9);
	while (words.length > 3 && words.join(" ").length > 58) {
		words = words.slice(0, -1);
	}
	return (words.join(" ").charAt(0).toUpperCase() + words.join(" ").slice(1)).replace(/[,\s]+$/, "");
}

/** Reject junk concepts (spec meta-lines like "~14–18 cards, build THIS first"). */
function isWorkableConcept(title: string): boolean {
	return /^[A-Za-z]/.test(title) && title.split(/\s+/).length >= 3 && title.length <= 90;
}

function slugify(text: string, max = 40): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, max)
			.replace(/-+$/, "") || "module"
	);
}

function pascal(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

// ---------------------------------------------------------------------------
// Card synthesis
// ---------------------------------------------------------------------------

function synthesizeCards(project: ProjectInput): CardPlan[] {
	const scope = sectionBullets(project.spec, "Foundation release scope");
	const seams = seamConcepts(project.spec);
	const target = expectedCardCount(project.spec, scope.length);
	const cards: CardPlan[] = [];
	const usedSlugs = new Set<string>();
	const usedTitles = new Set<string>();

	const claim = (base: string, set: Set<string>, sep: string): string => {
		let candidate = base;
		let counter = 2;
		while (set.has(candidate)) {
			candidate = `${base}${sep}${counter}`;
			counter += 1;
		}
		set.add(candidate);
		return candidate;
	};

	const push = (title: string, prompt: string, dependsOn: string[], complexity: number): CardPlan => {
		const id = `s${String(cards.length).padStart(2, "0")}`;
		const uniqueTitle = claim(title, usedTitles, " — part ");
		const moduleSlug = claim(slugify(uniqueTitle), usedSlugs, "-");
		const card: CardPlan = {
			id,
			title: uniqueTitle,
			// The prompt RESTATES the title first (realistic decompose style) and NAMES its module files — the
			// module path is the one string that exists ONLY in this card's prompt, and worker tracks key on it
			// (titles/bullets also appear inside the decompose spec that !Klein embeds into EVERY card prompt —
			// live cross-match incident 2026-07-10, project-02 run: one card's catch-all swallowed all workers).
			prompt:
				title === "Project scaffold: zero-dependency node test wiring"
					? `${uniqueTitle}. ${prompt}`
					: `${uniqueTitle}. ${prompt} Files for THIS card: src/${moduleSlug}.mjs and test/${moduleSlug}.test.mjs.`,
			dependsOn,
			complexity,
			filesLikelyTouched: [`src/${moduleSlug}.mjs`, `test/${moduleSlug}.test.mjs`],
			moduleSlug,
			conceptTitle: uniqueTitle,
		};
		cards.push(card);
		return card;
	};

	const scaffold = push(
		"Project scaffold: zero-dependency node test wiring",
		"Create the npm scaffold: package.json (private, type module, test script = node --test, NO dependencies) plus a README stub naming the product. npm test must exit 0 before any feature card lands. Do not add TypeScript or external test frameworks — the foundation uses plain ESM JavaScript with JSDoc types and node:test.",
		[],
		20,
	);
	scaffold.filesLikelyTouched = ["package.json", "README.md"];

	const domainBullet = scope[0] ?? "core domain entities with stable ids and audit history";
	const domain = push(
		"Core domain model and stable identifiers",
		`Create the core domain module: JSDoc-typed factories and validators for the core entities (${condenseTitle(domainBullet).toLowerCase()}). Every entity gets a stable string id, a createdAt ISO timestamp taken from an injected clock function, and an appendAudit(entry) helper that never mutates prior entries. Add node:test coverage for id stability, audit append-only behavior, and validator rejection of malformed input.`,
		[scaffold.id],
		30,
	);

	// Expand each remaining scope bullet into a model→engine(→edge-cases) chain, sized to hit the target count.
	const featureBullets = scope.slice(1);
	const remainingAfterCore = target - cards.length - 1; // reserve the final integration card
	const perBullet = Math.max(1, Math.floor(remainingAfterCore / Math.max(featureBullets.length + seams.length, 1)));
	const stageNames = ["core engine", "edge cases", "reporting seam"] as const;

	const expandConcept = (concept: string, budget: number) => {
		const baseTitle = condenseTitle(concept);
		let previous = domain;
		const stages = Math.max(1, Math.min(budget, 3));
		for (let stage = 0; stage < stages; stage += 1) {
			if (cards.length >= target - 1) return;
			const suffix = stage === 0 ? "" : ` — ${stageNames[Math.min(stage - 1, stageNames.length - 1)]}`;
			const title = `${baseTitle}${suffix}`;
			const prompt =
				stage === 0
					? `Implement the foundation for: ${concept} Create a pure, deterministic ESM module exporting an evaluate function that returns typed findings with evidence strings (no I/O, no Date.now, clock injected). Add node:test coverage for the accepted path and at least one blocking path.`
					: `Extend the ${baseTitle.toLowerCase()} module: ${stage === 1 ? "cover the hard edge cases the spec calls out (boundary values, conflicting inputs, replay determinism) with additional pure logic and tests" : "add a read-side projection that folds evaluations into an explainable report object, keeping every number traceable to input facts"}. Keep the module dependency-free and deterministic; every branch gets a node:test case.`;
			if (!isWorkableConcept(title)) continue;
			previous = push(title, prompt, stage === 0 ? [domain.id] : [previous.id], 30 + stage * 10);
		}
	};

	for (const bullet of featureBullets) expandConcept(bullet, perBullet);
	for (const seam of seams) {
		if (cards.length >= target - 1) break;
		expandConcept(seam, perBullet);
	}
	// Top up with generic hardening cards if the spec was thin.
	let hardeningIndex = 1;
	while (cards.length < target - 1) {
		push(
			`Determinism hardening pass ${hardeningIndex}`,
			"Sweep the existing modules for hidden nondeterminism (implicit ordering, locale-dependent formatting, floating-point drift) and lock the found cases with regression tests. Pure refactors only; behavior stays identical.",
			[domain.id],
			25,
		);
		hardeningIndex += 1;
	}

	const spineDeps = cards.slice(1, Math.min(6, cards.length)).map((card) => card.id);
	const integration = push(
		"Flagship integration test and foundation README",
		"Wire a flagship end-to-end node:test that walks one realistic scenario through the domain model and every evaluate module, asserting the full evidence chain, plus a README section documenting the foundation architecture and the knowledge-debt ledger. No placeholders — the scenario uses the seeded fixtures.",
		spineDeps,
		45,
	);
	return cards;
}

// ---------------------------------------------------------------------------
// Worker/review/track synthesis
// ---------------------------------------------------------------------------

function moduleSource(card: CardPlan): string {
	const p = pascal(card.moduleSlug);
	return `/**\n * ${card.conceptTitle}\n * Deterministic, dependency-free foundation module (generated baseline — hand-polish deepens domain logic).\n * @typedef {{ id: string, occurredAt: string, quantity: number, attributes?: Record<string, string> }} ${p}Input\n * @typedef {{ code: string, severity: "info" | "warning" | "critical", evidence: string[] }} ${p}Finding\n * @typedef {{ subjectId: string, status: "accepted" | "blocked", findings: ${p}Finding[] }} ${p}Result\n */\n\n/**\n * Evaluate one input against the ${card.conceptTitle.toLowerCase()} policy.\n * @param {${p}Input} input\n * @returns {${p}Result}\n */\nexport function evaluate${p}(input) {\n\tconst findings = [];\n\tif (!input || typeof input.id !== "string" || input.id.length === 0) {\n\t\treturn { subjectId: "unknown", status: "blocked", findings: [{ code: "${card.moduleSlug}/missing-id", severity: "critical", evidence: ["input.id is required"] }] };\n\t}\n\tif (!Number.isFinite(input.quantity) || input.quantity < 0) {\n\t\tfindings.push({ code: "${card.moduleSlug}/quantity-range", severity: "critical", evidence: [\`quantity \${input.quantity} is outside [0, ∞)\`] });\n\t}\n\tif (!/^\\d{4}-\\d{2}-\\d{2}T/.test(input.occurredAt ?? "")) {\n\t\tfindings.push({ code: "${card.moduleSlug}/timestamp-shape", severity: "warning", evidence: [\`occurredAt \${String(input.occurredAt)} is not ISO-8601\`] });\n\t}\n\tconst blocked = findings.some((finding) => finding.severity === "critical");\n\tif (findings.length === 0) {\n\t\tfindings.push({ code: "${card.moduleSlug}/clean", severity: "info", evidence: ["all deterministic checks passed"] });\n\t}\n\treturn { subjectId: input.id, status: blocked ? "blocked" : "accepted", findings };\n}\n`;
}

function moduleTest(card: CardPlan): string {
	const p = pascal(card.moduleSlug);
	return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { evaluate${p} } from "../src/${card.moduleSlug}.mjs";\n\ntest("${card.moduleSlug}: accepts a clean input with evidence", () => {\n\tconst result = evaluate${p}({ id: "subject-1", occurredAt: "2026-01-01T00:00:00.000Z", quantity: 1 });\n\tassert.equal(result.status, "accepted");\n\tassert.ok(result.findings.length > 0);\n\tassert.ok(result.findings.every((finding) => finding.evidence.length > 0));\n});\n\ntest("${card.moduleSlug}: blocks negative quantity with a critical finding", () => {\n\tconst result = evaluate${p}({ id: "subject-2", occurredAt: "2026-01-01T00:00:00.000Z", quantity: -1 });\n\tassert.equal(result.status, "blocked");\n\tassert.ok(result.findings.some((finding) => finding.severity === "critical"));\n});\n`;
}

function scaffoldFiles(project: ProjectInput): Array<{ path: string; content: string }> {
	return [
		{
			path: "package.json",
			content: `${JSON.stringify({ name: slugify(project.title, 60), private: true, type: "module", scripts: { test: "node --test" } }, null, "\t")}\n`,
		},
		{
			path: "README.md",
			content: `# ${project.title}\n\nDeterministic, dependency-free foundation (generated scenario baseline). Acceptance: \`${project.acceptanceCommand}\` via node:test.\n`,
		},
	];
}

function workerTrack(project: ProjectInput, card: CardPlan, options: { fixup?: boolean } = {}): ScenarioTrack {
	const files =
		card.id === "s00"
			? scaffoldFiles(project)
			: [
					{ path: `src/${card.moduleSlug}.mjs`, content: moduleSource(card) },
					{ path: `test/${card.moduleSlug}.test.mjs`, content: moduleTest(card) },
				];
	const turns: ScenarioTurn[] = [
		{ behavior: { kind: "tool_calls", calls: [{ name: "read_files", arguments: { paths: ["specification.md"] } }] } },
		{ behavior: { kind: "tool_calls", calls: [{ name: "write_files", arguments: { files } }] } },
		{ behavior: { kind: "tool_calls", calls: [{ name: "run_commands", arguments: { commands: [project.acceptanceCommand] } }] } },
		{
			behavior: {
				kind: "text",
				content: `Implemented "${card.title}": ${files.map((file) => file.path).join(", ")} with deterministic node:test coverage. Acceptance (${project.acceptanceCommand}) is green. Task complete.`,
			},
		},
	];
	if (options.fixup) {
		// A request_changes review round redrives the SAME worker session: occurrences 4/5 serve the fix + summary.
		turns.push(
			{
				behavior: {
					kind: "tool_calls",
					calls: [{ name: "write_files", arguments: { files: files.slice(-1) } }],
				},
			},
			{ behavior: { kind: "text", content: `Addressed the review feedback on "${card.title}" and re-ran the tests. Task complete.` } },
		);
	}
	return {
		id: `perfect-worker-${card.id}`,
		requestClass: "worker",
		// The per-card "Files for THIS card:" phrase — NOT the title (titles ride along in every prompt via the
		// embedded spec) and NOT the bare module path (!Klein's context focus brief ENUMERATES workspace paths,
		// so after a card merges, its path appears in every later session — live cross-match, run g4m2). The
		// scaffold card writes no module, so it keys on its authored title phrase (absent from any spec/brief).
		userMessageIncludes: card.id === "s00" ? "zero-dependency node test wiring" : `Files for THIS card: src/${card.moduleSlug}.mjs`,
		turns,
		repeatLastTurn: true,
		provenance: "generated baseline (generate-scenario-sets.mts)",
	};
}

function reviewTrack(card: CardPlan, options: { requestChangesFirst?: boolean } = {}): ScenarioTrack {
	const approve: ScenarioTurn = {
		behavior: {
			kind: "tool_calls",
			calls: [
				{
					name: "submit_review",
					arguments: {
						verdict: "approve",
						summary: `Reviewed "${card.title}": scope matches the card, logic is deterministic and dependency-free, tests cover accept + block paths. Approving.`,
					},
				},
			],
		},
	};
	const turns: ScenarioTurn[] = [];
	if (options.requestChangesFirst) {
		turns.push({
			behavior: {
				kind: "tool_calls",
				calls: [
					{
						name: "submit_review",
						arguments: {
							verdict: "request_changes",
							summary: `"${card.title}" is close but ships a gap the card explicitly owns.`,
							feedback: `The evaluate module for "${card.title}" only exercises the happy path plus one blocking case; the card asks for evidence on EVERY finding. Add an assertion that every finding carries non-empty evidence and re-run the acceptance command.`,
						},
					},
				],
			},
		});
	}
	turns.push(approve, { behavior: { kind: "text", content: "Review submitted." } });
	// Plain approve tracks CYCLE: the runtime resumes `<taskId>::review` across review rounds with its prior
	// transcript, so a linear [approve, text] ladder answers text-only (no verdict!) on every round ≥2 and the
	// card freezes in Review (live-found 2026-07-10 — a skipped round-1 finalize made round 2 hit turn index 1).
	// Bounce tracks keep the validated linear ladder (their request_changes→approve sequence is round-ordered).
	const cycle = !options.requestChangesFirst;
	return {
		id: `perfect-review-${card.id}`,
		requestClass: "review",
		userMessageIncludes: `the card "${card.title}"`,
		turns,
		...(cycle ? { cycleTurns: true } : { repeatLastTurn: true }),
		provenance: "generated baseline (generate-scenario-sets.mts)",
	};
}

function decomposeTrack(project: ProjectInput, cards: CardPlan[]): ScenarioTrack {
	const scope = sectionBullets(project.spec, "Foundation release scope");
	return {
		id: "perfect-decompose",
		// "any" + seed-only needle: a plan seed is wire-identical to a worker card (no universal decompose signal).
		requestClass: "any",
		userMessageIncludes: decomposeNeedle(project.userPrompt),
		turns: [
			{
				behavior: {
					kind: "tool_calls",
					calls: [
						{
							name: "decompose_project",
							arguments: {
								slug: slugify(project.title, 60),
								title: project.title,
								spec: `# ${project.title} — foundation requirements\n\n${scope.map((bullet) => `- ${bullet}`).join("\n")}\n\nDeterministic tests only (node:test, zero dependencies); every finding carries evidence; no network in acceptance.`,
								plan: `# Implementation plan\n\nBottom-up dependency order: scaffold, then the core domain model, then one deterministic evaluate module per foundation concern (model → engine → edge cases), closing with a flagship integration test + README. Every card ships its own node:test coverage; acceptance is \`${project.acceptanceCommand}\` everywhere.`,
								summary: `Build the ${project.title} foundation bottom-up: scaffold, typed domain model, deterministic evaluate modules per foundation concern, then a flagship integration test with an explainable evidence chain.`,
								defaultAcceptanceCommand: project.acceptanceCommand,
								tasks: cards.map((card) => ({
									id: card.id,
									title: card.title,
									prompt: card.prompt,
									dependsOn: card.dependsOn,
									complexity: card.complexity,
									filesLikelyTouched: card.filesLikelyTouched,
									acceptanceCommand: project.acceptanceCommand,
									testFirst: false,
								})),
							},
						},
					],
				},
			},
		],
		repeatLastTurn: true,
		provenance: "generated baseline (generate-scenario-sets.mts)",
	};
}

function chatTrack(project: ProjectInput): ScenarioTrack {
	return {
		id: "chat-status",
		requestClass: "chat",
		turns: [
			{
				behavior: {
					kind: "text",
					content: `The ${project.title} foundation is progressing card by card: scaffold first, then the domain model, then one deterministic evaluate module per foundation concern. Ask about any specific card for details.`,
				},
			},
		],
		repeatLastTurn: true,
		provenance: "generated baseline (generate-scenario-sets.mts)",
	};
}

function fallbackTrack(): ScenarioTrack {
	return {
		id: "any-fallback",
		requestClass: "any",
		turns: [{ behavior: { kind: "text", content: "Acknowledged. Proceeding as instructed." } }],
		repeatLastTurn: true,
		provenance: "generated baseline (generate-scenario-sets.mts)",
	};
}

// ---------------------------------------------------------------------------
// Perfect + flaky scripts
// ---------------------------------------------------------------------------

function perfectScript(project: ProjectInput, cards: CardPlan[], seed: number): ScenarioScript {
	const rng = createSeededRng(seed);
	const tracks: ScenarioTrack[] = [decomposeTrack(project, cards)];
	for (const card of cards) {
		// A seeded ~8% of cards take one request_changes→approve review ladder so the bounce path stays exercised.
		const bounce = card.id !== "s00" && rng.chance(0.08);
		tracks.push(workerTrack(project, card, { fixup: bounce }));
		tracks.push(reviewTrack(card, { requestChangesFirst: bounce }));
	}
	tracks.push(chatTrack(project), fallbackTrack());
	return { name: `${project.id} perfect run`, seed, tracks };
}

const FLAKY_CARD_COUNT = 10;

function flakyScript(project: ProjectInput, cards: CardPlan[], seed: number): ScenarioScript {
	const rng = createSeededRng(seed);
	const subset = cards.slice(0, FLAKY_CARD_COUNT).map((card) => ({
		...card,
		dependsOn: card.dependsOn.filter((dep) => cards.slice(0, FLAKY_CARD_COUNT).some((kept) => kept.id === dep)),
	}));
	const tracks: ScenarioTrack[] = [decomposeTrack(project, subset)];
	// Distinct failure modes from docs/dev/llm-simulator/failure-catalog.md, one per seeded card, with recovery.
	const failureKinds = ["t-429-rate", "c-empty-completion", "c-reasoning-only", "t-sse-stall-mid", "c-trunc-tool-json"] as const;
	const failing = new Map<string, (typeof failureKinds)[number]>();
	for (const [index, card] of subset.entries()) {
		if (card.id === "s00") continue;
		if (failing.size < failureKinds.length && rng.chance(0.7)) {
			failing.set(card.id, failureKinds[failing.size] as (typeof failureKinds)[number]);
		}
		if (index >= subset.length - 1) break;
	}
	for (const card of subset) {
		const failure = failing.get(card.id);
		const base = workerTrack(project, card);
		if (failure) {
			const recoveryTurns = base.turns;
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
											calls: [{ name: "write_files", arguments: { files: `[{"path":"src/${card.moduleSlug}.mjs","content":"export const truncated = ` } }],
										},
									};
			base.turns = [failureTurn, ...recoveryTurns];
			base.id = `flaky-worker-${card.id}`;
			base.provenance = `generated flaky baseline — ${failure} then recovery (failure-catalog.md)`;
		}
		tracks.push(base);
		tracks.push(reviewTrack(card));
	}
	tracks.push(chatTrack(project), fallbackTrack());
	return { name: `${project.id} flaky run`, seed, tracks };
}

// ---------------------------------------------------------------------------
// Validation + IO
// ---------------------------------------------------------------------------

function validate(script: ScenarioScript, cards: CardPlan[]): void {
	const fixtures = compileScenarioScript(script);
	if (fixtures.length < script.tracks.length) throw new Error(`${script.name}: compiled ${fixtures.length} fixtures < ${script.tracks.length} tracks`);
	const needles = script.tracks.filter((track) => track.requestClass === "worker").map((track) => track.userMessageIncludes);
	if (new Set(needles).size !== needles.length) throw new Error(`${script.name}: duplicate worker needles`);
	const ids = new Set(cards.map((card) => card.id));
	for (const card of cards) {
		for (const dep of card.dependsOn) if (!ids.has(dep)) throw new Error(`${script.name}: ${card.id} depends on missing ${dep}`);
	}
	const titles = new Set(cards.map((card) => card.title));
	if (titles.size !== cards.length) throw new Error(`${script.name}: duplicate card titles`);

	// Needle EXCLUSIVITY (live incident, project-02 run 2026-07-10): !Klein embeds the decompose spec into every
	// card prompt, so a worker needle that appears in the spec/plan or another card's prompt cross-matches and
	// one card's catch-all swallows every other worker session. Each needle must hit EXACTLY its own card.
	const decomposeArgs = script.tracks
		.flatMap((track) => track.turns)
		.flatMap((turn) => (turn.behavior.kind === "tool_calls" ? turn.behavior.calls : []))
		.filter((call) => call.name === "decompose_project")
		.map((call) => call.arguments as { spec?: string; plan?: string; summary?: string; tasks?: Array<{ id: string; prompt: string }> });
	for (const args of decomposeArgs) {
		const shared = `${args.spec ?? ""}\n${args.plan ?? ""}\n${args.summary ?? ""}`.toLowerCase();
		const tasks = args.tasks ?? [];
		for (const track of script.tracks.filter((track) => track.requestClass === "worker")) {
			const needle = (track.userMessageIncludes ?? "").toLowerCase();
			if (shared.includes(needle)) throw new Error(`${script.name}: worker needle "${needle}" leaks into the shared spec/plan/summary`);
			const hits = tasks.filter((task) => task.prompt.toLowerCase().includes(needle));
			if (hits.length !== 1) throw new Error(`${script.name}: worker needle "${needle}" matches ${hits.length} card prompts (must be exactly 1)`);
		}
	}
}

function readme(project: ProjectInput, cards: CardPlan[], flakyTrackCount: number): string {
	return `# Scenario set: ${project.id}

GENERATED baseline (scripts/generate-scenario-sets.mts, 2026-07-10) conforming to \`packages/llm-simulator/src/scenario/track-types.ts\` — the scaled sibling of the hand-authored set 01. Hand-polish deepens domain realism later; real-model telemetry hardens it via the record→distill loop.

- **perfect-run.json** — 1 decompose (${cards.length} dependency-linked cards from the spec's foundation scope + hardest-seam sections), per-card worker tracks (read → write real zero-dependency ESM modules + node:test files → run \`${project.acceptanceCommand}\` → text), per-card review tracks (submit_review approve with summary; a seeded ~8% bounce once with request_changes), 1 chat, any-fallback.
- **flaky-run.json** — decompose reduced to ${FLAKY_CARD_COUNT} cards; ${flakyTrackCount} failure tracks (catalog ids in each track's provenance) with scripted recovery; control workers; per-card reviews; any-fallback.

Wire truths encoded (see packages/llm-simulator/test/request-classifier.test.ts): decompose is class **any** keyed on the seed-only product phrase; worker/review tracks are per-card (sequenceIndex is per-fixture); submit_review carries non-empty \`summary\`; every ladder closes with a text turn + repeatLastTurn.

Generated card content is deliberately dependency-free ESM JavaScript verified by \`node --test\`, so acceptance is green offline with no install step.
`;
}

async function loadProject(dirName: string): Promise<ProjectInput> {
	const dir = join(PROJECTS_DIR, dirName);
	const meta = JSON.parse(await readFile(join(dir, "project.json"), "utf8")) as {
		id: string;
		title: string;
		acceptanceCommand: string;
		tier?: string;
	};
	return {
		dir,
		id: meta.id,
		title: meta.title,
		acceptanceCommand: meta.acceptanceCommand,
		tier: meta.tier ?? "",
		userPrompt: await readFile(join(dir, "user-prompt.txt"), "utf8"),
		spec: await readFile(join(dir, "specification.md"), "utf8"),
	};
}

async function main(): Promise<void> {
	const requested = process.argv.slice(2);
	const all = readdirSync(PROJECTS_DIR).filter((name) => /^\d{2}_/.test(name)).sort();
	const targets = all.filter((name) => {
		const nn = name.slice(0, 2);
		if (requested.length > 0) return requested.includes(nn);
		return nn >= "02" && nn <= "20";
	});
	for (const dirName of targets) {
		const project = await loadProject(dirName);
		const nn = Number(dirName.slice(0, 2));
		const cards = synthesizeCards(project);
		const perfect = perfectScript(project, cards, 100 + nn);
		const flaky = flakyScript(project, cards, 200 + nn);
		validate(perfect, cards);
		validate(flaky, cards.slice(0, FLAKY_CARD_COUNT));
		const outDir = join(SCENARIOS_DIR, project.id);
		await mkdir(outDir, { recursive: true });
		await writeFile(join(outDir, "perfect-run.json"), `${JSON.stringify(perfect, null, "\t")}\n`);
		await writeFile(join(outDir, "flaky-run.json"), `${JSON.stringify(flaky, null, "\t")}\n`);
		const flakyFailureCount = flaky.tracks.filter((track) => track.id.startsWith("flaky-worker-")).length;
		await writeFile(join(outDir, "README.md"), readme(project, cards, flakyFailureCount));
		console.log(
			`${project.id}: ${cards.length} cards, perfect ${perfect.tracks.length} tracks (${compileScenarioScript(perfect).length} fixtures), flaky ${flaky.tracks.length} tracks (${compileScenarioScript(flaky).length} fixtures)`,
		);
	}
	console.log(`Generated ${targets.length} scenario set(s).`);
}

await main();
