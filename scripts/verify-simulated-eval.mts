/**
 * §5.AB eval-harness REPEATED-RUN LOOP verification at memory speed (todo 5914) — run the real
 * `scripts/eval-harness.mts` against the LLM SIMULATOR, with fixture tracks GENERATED FROM the corpus answer
 * keys. Every cell must score 1.0 across N repeats and every stability cell must judge "settled": that proves
 * the repeat loop, the aggregation, the stability judgment, and the extraction plumbing end-to-end without any
 * model compute. (Live model evals stay the real-fleet path — this verifies the MACHINERY deterministically.)
 *
 * Usage:  npx tsx scripts/verify-simulated-eval.mts       (self-contained; no isolated HOME needed — the
 *         harness only reads env + hits the chat URL, and persistence stays OFF without NKLEIN_EVAL_PERSIST.)
 */

import { spawn } from "node:child_process";
import { createSimulatorServer } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript, ScenarioTrack } from "../packages/llm-simulator/src/index.js";
import { EVAL_PROMPT_CORPUS, type ReviewEvalPrompt } from "../src/core/eval-prompt-corpus.js";

/** Content-channel structured strategy is selected for coder-named models — keep "coder" in the id. */
const EVAL_MODEL = "sim/eval-coder";
/** targetSettledRuns of the stability policy — at this count deterministic fixtures must judge "settled_pass". */
const REPEATS = 6;

function fail(message: string): never {
	console.error(`FAIL ✗ ${message}`);
	process.exit(1);
}

/** Matcher-friendly phrasing per canonical defect id (see DEFECT_MATCHERS in eval-answer-extraction.ts). */
const DEFECT_PHRASES: Readonly<Record<string, string>> = {
	"off-by-one": "There is an off-by-one error: the loop reads one past the end of the array.",
	"null-deref": "Possible null dereference: the field can be null when accessed.",
	"unhandled-rejection": "The promise is never awaited — an unhandled rejection escapes.",
	"toctou-race": "Time-of-check to time-of-use race condition between the existence check and the create.",
	"resource-leak": "Resource leak: the file handle is never closed on the early-return path.",
	"sql-injection": "SQL injection: user input is concatenated into the query string unsanitized.",
	"hardcoded-secret": "A hardcoded secret/credential is committed in the source.",
	"integer-overflow": "Integer overflow: the multiplication can exceed the safe range.",
	"missing-validation": "Missing input validation before use.",
	"catch-swallow": "The catch block swallows the error silently.",
};

function reviewAnswerText(row: ReviewEvalPrompt): string {
	const findings = row.seededDefects.map((id, index) => {
		const phrase = DEFECT_PHRASES[id] ?? `Defect ${id.replaceAll("-", " ")} is present.`;
		return `${index + 1}. ${phrase}`;
	});
	return `Review findings:\n${findings.join("\n")}`;
}

/**
 * P22.2 — reference implementations served to the simulated eval for the `implement` family.
 *
 * These ARE the answer key: they are the same code used to self-test the corpus assertions, and each scores full
 * marks. Serving anything less would make this script's "every family passes through the real path" claim depend
 * on a candidate that does not actually work.
 */
const IMPLEMENT_FIXTURE_CODE: Record<string, string> = {
	"implement-slugify":
		"function slugify(t){return String(t).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}",
	"implement-debounce":
		"function debounce(fn, ms){let t=null;let lastArgs=null;const wrapped=(...args)=>{lastArgs=args;if(t)clearTimeout(t);t=setTimeout(()=>{t=null;fn(...lastArgs);},ms);};wrapped.cancel=()=>{if(t){clearTimeout(t);t=null;}};return wrapped;}",
	"implement-lru-cache":
		"class LruCache{constructor(capacity){this.cap=capacity;this.m=new Map();}get(k){if(!this.m.has(k))return undefined;const v=this.m.get(k);this.m.delete(k);this.m.set(k,v);return v;}put(k,v){if(this.cap<=0)return;if(this.m.has(k))this.m.delete(k);this.m.set(k,v);if(this.m.size>this.cap){this.m.delete(this.m.keys().next().value);}}}",
};

function buildTracks(): ScenarioTrack[] {
	const tracks: ScenarioTrack[] = [];
	for (const row of EVAL_PROMPT_CORPUS) {
		const needle = row.prompt.slice(0, 60);
		if (row.family === "implement") {
			// P22.2 (2026-07-31): the harness now EXECUTES implement cells in a permission-restricted child, so a
			// fixture must serve real code. Each corpus row's own reference implementation is served, keeping this
			// script's contract intact: every family is exercised through the real repeated-eval path.
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				// ⚠️ `userMessageIncludes`, NOT `match: { contains }` — the latter is a field the track compiler does
				// not read. With no needle the track matched EVERY request, and since aimock serves the FIRST
				// matching fixture, every implement prompt received `implement-slugify`'s code. Slugify therefore
				// scored 1 while debounce and lru-cache scored 0, which surfaced as two "flaky" stability cells
				// rather than as a broken fixture — the verdict aggregates a whole (role, tier) cell, and their
				// cell-mates were passing.
				userMessageIncludes: needle,
				turns: [{ behavior: { kind: "text", content: IMPLEMENT_FIXTURE_CODE[row.id] ?? "" } }],
			});
			continue;
		}
		if (row.family === "decompose") {
			// Serve the row's OWN reference graph in the tasks/dependsOn shape the extractor rebuilds losslessly:
			// an edge {from: dep, to: task} means `task.dependsOn` includes `dep`.
			const dependsOnByNode = new Map<string, string[]>();
			for (const edge of row.reference.edges) {
				const deps = dependsOnByNode.get(edge.to) ?? [];
				deps.push(edge.from);
				dependsOnByNode.set(edge.to, deps);
			}
			const tasks = row.reference.nodes.map((node) => ({ id: node, dependsOn: dependsOnByNode.get(node) ?? [] }));
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				userMessageIncludes: needle,
				turns: [{ behavior: { kind: "text", content: JSON.stringify({ tasks }) } }],
				repeatLastTurn: true,
				provenance: "generated from the corpus answer key (verify-simulated-eval)",
			});
		} else if (row.family === "tool_use") {
			// Serve the expected tool call, or a plain-text answer for an irrelevance probe (expected === null).
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				userMessageIncludes: needle,
				turns: [
					row.expected
						? { behavior: { kind: "tool_calls", calls: [{ name: row.expected.name, arguments: row.expected.args }] } }
						: { behavior: { kind: "text", content: "No tool fits this request; answering directly instead." } },
				],
				repeatLastTurn: true,
				provenance: "generated from the corpus answer key (verify-simulated-eval)",
			});
		} else if (row.family === "context_probe") {
			// Return a canonical answer-key fragment. Context probes deliberately score content recovery, not formatting.
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				userMessageIncludes: needle,
				turns: [{ behavior: { kind: "text", content: row.expectedFragments[0] ?? "" } }],
				repeatLastTurn: true,
				provenance: "generated from the corpus answer key (verify-simulated-eval)",
			});
		} else {
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				userMessageIncludes: needle,
				turns: [{ behavior: { kind: "text", content: reviewAnswerText(row) } }],
				repeatLastTurn: true,
				provenance: "generated from the corpus answer key (verify-simulated-eval)",
			});
		}
	}
	tracks.push({
		id: "eval-fallback",
		requestClass: "any",
		turns: [{ behavior: { kind: "text", content: "no answer" } }],
		repeatLastTurn: true,
	});
	return tracks;
}

async function main(): Promise<void> {
	const script: ScenarioScript = { name: "simulated-eval", seed: 5, tracks: buildTracks() };
	const simulator = createSimulatorServer(script, {
		models: [{ id: EVAL_MODEL, state: "loaded", family: "qwen", maxContextLength: 65536 }],
	});
	await simulator.start();
	console.log(`Simulator: ${simulator.url()} (${script.tracks.length} tracks from the corpus answer keys)`);

	try {
		const child = spawn("npx", ["tsx", "scripts/eval-harness.mts"], {
			env: {
				...process.env,
				NKLEIN_VERIFY_MODEL: EVAL_MODEL,
				NKLEIN_VERIFY_BASE_URL: simulator.url(),
				NKLEIN_EVAL_REPEATS: String(REPEATS),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
		const exitCode: number = await new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));

		if (exitCode !== 0) {
			fail(`eval-harness exited ${exitCode} (expected 0 — every fixture-served cell must pass the bar)`);
		}
		const stabilityLines = out.split("\n").filter((line) => line.includes("stability["));
		if (stabilityLines.length === 0) {
			fail("no stability judgment printed — the repeated-run loop did not engage (REPEATS>1 expected)");
		}
		const unsettled = stabilityLines.filter((line) => !line.includes("settled_pass"));
		if (unsettled.length > 0) {
			fail(`stability cells not settled despite deterministic fixtures:\n${unsettled.join("\n")}`);
		}
		console.log(
			`PASS ✓ repeated-run loop verified: ${stabilityLines.length} cells × ${REPEATS} repeats, all settled, harness exit 0, zero LLM compute.`,
		);
	} finally {
		await simulator.stop();
	}
}

await main();
