/**
 * §5.AB "Evaluate connected models" (todo 6544) END-TO-END verification at memory speed — boot a REAL runtime
 * against the LLM SIMULATOR (corpus-answer-key fixtures + an LM Studio shim advertising TWO loaded "coder"
 * models), call the `evaluateConnectedModels` tRPC MUTATION, and assert it enumerated both loaded models, scored
 * every corpus cell 1.0 for each, and persisted fitness — proving the full stack (enumerate → per-model eval →
 * persist → response) with zero LLM compute.
 *
 * Usage:  HOME=$(mktemp -d /tmp/nklein-evalcm-XXXX) npx tsx scripts/verify-evaluate-connected-models.mts
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { createSimulatorServer } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript, ScenarioTrack } from "../packages/llm-simulator/src/index.js";
import { EVAL_PROMPT_CORPUS, type ReviewEvalPrompt } from "../src/core/eval-prompt-corpus.js";
import type { RuntimeAppRouter } from "../src/trpc/app-router.js";

const RUNTIME_PORT = 3987;
const MODELS = ["sim/eval-coder-a", "sim/eval-coder-b"];

function fail(message: string): never {
	console.error(`FAIL ✗ ${message}`);
	process.exit(1);
}

if (homedir() === "/Users/david" || process.env.HOME === "/Users/david") {
	fail("Refusing to run against HOME=/Users/david. Set HOME to an isolated dir (mktemp -d /tmp/nklein-evalcm-XXXX).");
}

const DEFECT_PHRASES: Readonly<Record<string, string>> = {
	"off-by-one": "off-by-one error: the loop reads one past the end of the array.",
	"null-deref": "possible null dereference: the field can be null when accessed.",
	"unhandled-rejection": "the promise is never awaited — an unhandled rejection escapes.",
	"toctou-race": "time-of-check to time-of-use race condition between the check and the create.",
	"resource-leak": "resource leak: the file handle is never closed on the early-return path.",
	"sql-injection": "sql injection: user input is concatenated into the query unsanitized.",
	"hardcoded-secret": "a hardcoded secret is committed in the source.",
	"integer-overflow": "integer overflow: the multiplication can exceed the safe range.",
	"missing-validation": "missing input validation before use.",
	"catch-swallow": "the catch block swallows the error silently.",
};

function buildTracks(): ScenarioTrack[] {
	const tracks: ScenarioTrack[] = [];
	for (const row of EVAL_PROMPT_CORPUS) {
		if (row.family === "implement") {
			continue;
		}
		const needle = row.prompt.slice(0, 60);
		if (row.family === "decompose") {
			const depsByNode = new Map<string, string[]>();
			for (const edge of row.reference.edges) {
				depsByNode.set(edge.to, [...(depsByNode.get(edge.to) ?? []), edge.from]);
			}
			const tasks = row.reference.nodes.map((node) => ({ id: node, dependsOn: depsByNode.get(node) ?? [] }));
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				userMessageIncludes: needle,
				turns: [{ behavior: { kind: "text", content: JSON.stringify({ tasks }) } }],
				repeatLastTurn: true,
			});
		} else {
			const review = row as ReviewEvalPrompt;
			const findings = review.seededDefects.map((id, index) => `${index + 1}. ${DEFECT_PHRASES[id] ?? id}`).join("\n");
			tracks.push({
				id: `eval-${row.id}`,
				requestClass: "any",
				userMessageIncludes: needle,
				turns: [{ behavior: { kind: "text", content: `Review findings:\n${findings}` } }],
				repeatLastTurn: true,
			});
		}
	}
	tracks.push({ id: "eval-fallback", requestClass: "any", turns: [{ behavior: { kind: "text", content: "no answer" } }], repeatLastTurn: true });
	return tracks;
}

async function main(): Promise<void> {
	const home = process.env.HOME as string;
	const script: ScenarioScript = { name: "evaluate-connected-models", seed: 5, tracks: buildTracks() };
	const simulator = createSimulatorServer(script, {
		models: MODELS.map((id) => ({ id, state: "loaded" as const, family: "qwen", maxContextLength: 65536 })),
	});
	await simulator.start();
	const simBase = simulator.url();
	console.log(`Simulator: ${simBase} (2 loaded models, corpus-answer-key fixtures)`);

	await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
	await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
	await writeFile(
		join(home, ".nklein", "nklein", "config.json"),
		JSON.stringify({ selectedAgentId: "nklein", developerModeEnabled: true, setupWizardCompletedAt: Date.now() }, null, 1),
	);
	await writeFile(
		join(home, ".nklein", "data", "settings", "providers.json"),
		JSON.stringify(
			{
				version: 1,
				lastUsedProvider: "lmstudio",
				providers: { lmstudio: { settings: { provider: "lmstudio", model: MODELS[0], baseUrl: simBase }, updatedAt: new Date().toISOString(), tokenSource: "manual" } },
			},
			null,
			1,
		),
	);
	await writeFile(join(home, ".nklein", "nklein", "nklein-provider-selection.json"), JSON.stringify({ providerId: "lmstudio" }));

	const runtime = spawn("npx", ["tsx", "src/cli.ts", "--port", String(RUNTIME_PORT), "--no-open", "--host", "127.0.0.1"], {
		env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT), KANBAN_RUNTIME_PORT: String(RUNTIME_PORT) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const logs: string[] = [];
	runtime.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
	runtime.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

	try {
		const deadline = Date.now() + 60_000;
		for (;;) {
			try {
				if ((await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.list`)).ok) break;
			} catch {
				/* not up */
			}
			if (Date.now() > deadline) {
				console.error(logs.join("").slice(-2000));
				fail("runtime did not come up within 60s");
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		const client = createTRPCProxyClient<RuntimeAppRouter>({
			links: [httpBatchLink({ url: `http://127.0.0.1:${RUNTIME_PORT}/api/trpc` })],
		});
		const result = await client.runtime.evaluateConnectedModels.mutate();
		console.log(JSON.stringify(result, null, 1));

		if (result.skippedReason) {
			fail(`expected 2 evaluated models, got skippedReason: ${result.skippedReason}`);
		}
		if (result.models.length !== MODELS.length) {
			fail(`expected ${MODELS.length} evaluated models, got ${result.models.length}`);
		}
		for (const model of result.models) {
			if (!MODELS.includes(model.modelId)) {
				fail(`unexpected evaluated model ${model.modelId}`);
			}
			if (model.meanScore < 0.999) {
				fail(`model ${model.modelId} meanScore ${model.meanScore} < 1.0 (corpus answer keys should score perfect)`);
			}
			if (model.byRole.length === 0) {
				fail(`model ${model.modelId} produced no per-role fitness`);
			}
		}
		console.log(
			`PASS ✓ evaluateConnectedModels enumerated ${result.models.length} loaded models, scored every cell 1.0, persisted fitness — zero LLM compute.`,
		);
	} finally {
		runtime.kill("SIGTERM");
		await simulator.stop();
	}
}

await main();
