/**
 * F4.6 live proof: run a paired full-evidence control and production-trimmed synthesis prompt against every resident
 * LM Studio chat model. Facts + citation ids are scored deterministically; the model is never asked to grade itself.
 * This script never loads, unloads, or downloads models.
 *
 * Optional env:
 *   NKLEIN_VERIFY_MODELS=model-a,model-b
 *   NKLEIN_VERIFY_BASE_URL=http://127.0.0.1:1234/v1
 *   NKLEIN_SYNTHESIS_QUALITY_TIMEOUT_MS=180000
 */

import {
	buildSynthesisEvidenceQualityCases,
	runSynthesisEvidenceQualityEval,
} from "../src/core/synthesis-evidence-quality-eval";

const RAW_BASE = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1").trim().replace(/\/+$/u, "");
const BASE_URL = RAW_BASE.endsWith("/v1") ? RAW_BASE : `${RAW_BASE}/v1`;
const TIMEOUT_MS = Math.max(1_000, Number(process.env.NKLEIN_SYNTHESIS_QUALITY_TIMEOUT_MS ?? "180000"));

interface ChatPayload {
	choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
	error?: unknown;
}

async function residentModels(): Promise<string[]> {
	const configured = (process.env.NKLEIN_VERIFY_MODELS ?? "")
		.split(",")
		.map((model) => model.trim())
		.filter(Boolean);
	if (configured.length > 0) return configured;
	const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) throw new Error(`LM Studio model discovery failed: HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	return (payload.data ?? []).flatMap((entry) => (entry.id && !entry.id.includes("embed") ? [entry.id] : []));
}

async function complete(model: string, prompt: string, label: string): Promise<string> {
	const response = await fetch(`${BASE_URL}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: prompt }],
			temperature: 0.2,
			max_tokens: 1_500,
			stream: false,
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const body = await response.text();
	if (!response.ok) throw new Error(`${model} ${label}: HTTP ${response.status}: ${body.slice(0, 500)}`);
	let payload: ChatPayload;
	try {
		payload = JSON.parse(body) as ChatPayload;
	} catch {
		throw new Error(`${model} ${label}: LM Studio returned malformed JSON: ${body.slice(0, 500)}`);
	}
	if (payload.error) throw new Error(`${model} ${label}: ${JSON.stringify(payload.error).slice(0, 500)}`);
	const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
	if (!content) {
		throw new Error(`${model} ${label}: empty completion (finish=${payload.choices?.[0]?.finish_reason ?? "unknown"})`);
	}
	return content;
}

async function main(): Promise<void> {
	const models = await residentModels();
	if (models.length === 0) throw new Error(`No resident chat models found at ${BASE_URL}.`);
	let fleetRegressions = 0;
	let fleetScorable = 0;
	for (const model of models) {
		process.stdout.write(`F4.6 ${model}\n`);
		const report = await runSynthesisEvidenceQualityEval(buildSynthesisEvidenceQualityCases(), ({
			caseId,
			variant,
			prompt,
		}) => complete(model, prompt, `${caseId}/${variant}`));
		fleetRegressions += report.regressions;
		fleetScorable += report.scorablePairs;
		for (const pair of report.pairs) {
			process.stdout.write(
				`  ${pair.caseId}: full=${pair.full.score.toFixed(2)} trimmed=${pair.trimmed.score.toFixed(2)} ` +
					`tokens=${pair.tokensBefore}->${pair.tokensAfter} ${pair.regressed ? "REGRESSION" : "retained"}\n`,
			);
		}
		process.stdout.write(
			`  verdict=${report.passed ? "PASS" : "FAIL"} scorable=${report.scorablePairs}/${report.pairs.length} ` +
				`regressions=${report.regressions} full-pass=${Math.round(report.fullPassRate * 100)}% ` +
				`trimmed-pass=${Math.round(report.trimmedPassRate * 100)}% saving=${Math.round(report.tokenSavingFraction * 100)}%\n`,
		);
	}
	if (fleetScorable === 0) throw new Error("F4.6 LIVE FAIL: no full-evidence control produced a scorable answer.");
	if (fleetRegressions > 0) throw new Error(`F4.6 LIVE FAIL: ${fleetRegressions} paired extraction regression(s).`);
	process.stdout.write(`F4.6 LIVE PASS: ${models.length} model(s), ${fleetScorable} scorable pair(s), zero regressions.\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});
