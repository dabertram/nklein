/**
 * §13d REFLECTION-LOOP capture campaign (real telemetry) — run the eval corpus against a REAL loaded model THROUGH
 * the aimock passthrough record proxy, so every real request/response is saved as a fixture on disk. This exercises
 * the "aimock collects real LLM responses whenever reasonable" loop end-to-end: a small model, a bounded workload,
 * captures that `scripts/distill-capture.mts` folds into scenario tracks (keyed by the failure catalog).
 *
 * The caller loads/unloads the model (as-needed, no host overload). This script only routes + captures.
 *
 * Usage:  NKLEIN_CAPTURE_MODEL=qwen3-8b-capture npx tsx scripts/capture-real-eval.mts [--out captures/<name>] [--upstream http://127.0.0.1:1234]
 */

import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRecordProxy } from "../packages/llm-simulator/src/index.js";
import { runModelEval } from "../src/nklein-agent/model-eval-runner.js";
import type { ModelEvalChat, ModelEvalChatChoice } from "../src/nklein-agent/model-eval-runner.js";

function argValue(flag: string, fallback: string): string {
	const index = process.argv.indexOf(flag);
	return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

const MODEL = process.env.NKLEIN_CAPTURE_MODEL?.trim() || "";
const UPSTREAM = argValue("--upstream", "http://127.0.0.1:1234");
const OUT = resolve(argValue("--out", `captures/eval-${new Date().toISOString().slice(0, 10)}`));

if (!MODEL) {
	console.error("capture-real-eval: NKLEIN_CAPTURE_MODEL is required (a loaded model id)");
	process.exit(64);
}

async function main(): Promise<void> {
	mkdirSync(OUT, { recursive: true });
	const proxy = createRecordProxy({ upstreamOpenAiUrl: UPSTREAM, fixturePath: OUT, proxyOnly: false });
	await proxy.start();
	const chatUrl = `${proxy.url()}/chat/completions`;
	console.log(`Record proxy: ${proxy.url()} → upstream ${UPSTREAM}\nCapturing eval corpus for model "${MODEL}" into ${OUT}`);

	const chat: ModelEvalChat = async (messages, extra) => {
		try {
			const res = await fetch(chatUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: 2500, ...extra }),
			});
			const json = (await res.json()) as { choices?: ModelEvalChatChoice[]; error?: unknown };
			return json.error ? null : (json.choices?.[0] ?? null);
		} catch {
			return null;
		}
	};

	try {
		const result = await runModelEval({ modelId: MODEL, repeats: 1 }, { chat });
		console.log(`\nEval mean ${result.meanScore.toFixed(3)} over ${result.scoredAttempts}/${result.totalAttempts} scored cells (strategy ${result.strategy}).`);
		for (const cell of result.cells) {
			console.log(`  [${cell.role}/${cell.difficulty}] ${cell.id} → ${cell.score === null ? "NO ANSWER" : cell.score.toFixed(2)} (${cell.latencyMs}ms)`);
		}
	} finally {
		await proxy.stop();
	}

	const captureFiles = readdirSync(OUT).filter((name) => name.endsWith(".json"));
	console.log(`\nCaptured ${captureFiles.length} fixture file(s) → ${OUT}`);
	console.log(`Next: npx tsx scripts/distill-capture.mts ${OUT}`);
}

await main();
