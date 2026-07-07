// §5.U cohesive extraction (2026-07-07): the `nklein dev tool-menu` / `dev tool-pick` two-phase-tool CLI commands
// (§5.O inspection + live pick with the §5.AA truncation-recovery demo), lifted out of the large `commands/dev.ts`.
// Focused, imports-only coupling — no shared dev-runtime client.
import { raisedTokenBudget } from "../core/retry-policy";
import { buildTwoPhaseToolMenuReport } from "../nklein-agent/nklein-two-phase-tool-menu-report";
import { runTwoPhaseToolPick } from "../nklein-agent/two-phase-tool-runner";

export async function runDevToolMenuCommand(options: { json?: boolean } = {}): Promise<void> {
	// §5.O inspection: render the phase-1 tool menu a SMALL model is shown (short cards, not verbose schemas) so an
	// operator can review the card text + its token footprint. Pure/offline — no model, no live agent loop.
	const report = buildTwoPhaseToolMenuReport();
	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	process.stdout.write("!Klein two-phase tool menu — the phase-1 cards a small model is offered (§5.O):\n\n");
	process.stdout.write(report.menu);
	process.stdout.write(`\n\n(${report.toolCount} tools, ~${report.menuTokens} tokens)\n`);
}

export async function runDevToolPickCommand(options: {
	task: string;
	model?: string;
	budget?: string;
	maxRetries?: string;
	json?: boolean;
}): Promise<void> {
	// §5.O live: run the phase-1 two-phase pick for a task against a LOADED model (no loading — auto-discovers a resident
	// LLM when --model is omitted). Reasoning-sized budget by default: a small reasoning model spends ~400 tokens reasoning
	// BEFORE the pick, so too small a budget yields empty content + finish:length. On such a TRUNCATION we escalate the
	// budget via `raisedTokenBudget` (§5.AA) and retry — a live demo of the truncation-recovery rung. Read-only.
	const base = "http://localhost:1234";
	let modelId = options.model?.trim();
	if (!modelId) {
		const modelsResponse = await fetch(`${base}/api/v0/models`).catch(() => null);
		const modelsJson = (await modelsResponse?.json().catch(() => null)) as {
			data?: Array<{ id?: string; type?: string; state?: string }>;
		} | null;
		modelId = modelsJson?.data?.find((m) => m.state === "loaded" && m.type === "llm")?.id;
		if (!modelId) {
			throw new Error(`No loaded LLM found at ${base}/api/v0/models — load a model or pass --model.`);
		}
	}
	const startBudget = Math.max(64, Number.parseInt(options.budget ?? "1024", 10) || 1024);
	const maxRetries = Math.max(0, Number.parseInt(options.maxRetries ?? "3", 10) || 0);
	const escalation = { budgetUsed: startBudget, retries: 0 };

	const callOnce = async (menu: string, task: string, tokenBudget: number) => {
		const response = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: modelId,
				temperature: 0,
				max_tokens: tokenBudget,
				messages: [
					{ role: "system", content: menu },
					{ role: "user", content: `Step: ${task}\nYour single-line answer:` },
				],
			}),
		});
		if (!response.ok) {
			throw new Error(`tool-pick completion failed (${response.status}) at ${base}/v1/chat/completions.`);
		}
		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
		};
		const choice = json.choices?.[0];
		return { content: choice?.message?.content ?? "", finishReason: choice?.finish_reason ?? null };
	};

	const result = await runTwoPhaseToolPick({
		task: options.task,
		callModel: async ({ menu, task }) => {
			let budget = startBudget;
			let raw = await callOnce(menu, task, budget);
			// Truncation-recovery: an empty answer with finish:length means the model ran out of budget mid-reasoning →
			// escalate the budget (§5.AA `raisedTokenBudget`) and retry, up to --max-retries.
			while (raw.content.trim() === "" && raw.finishReason === "length" && escalation.retries < maxRetries) {
				escalation.retries += 1;
				budget = raisedTokenBudget({ current: budget, attempt: escalation.retries });
				escalation.budgetUsed = budget;
				raw = await callOnce(menu, task, budget);
			}
			return raw;
		},
	});
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ modelId, startBudget, ...escalation, task: options.task, ...result }, null, 2)}\n`,
		);
		return;
	}
	const decision = result.decision;
	const shown = decision.kind === "one_tool" ? `one_tool → ${decision.tool}` : decision.kind;
	const escalated = escalation.retries > 0 ? ` (escalated ${escalation.retries}× → ${escalation.budgetUsed})` : "";
	process.stdout.write(
		`!Klein two-phase pick (§5.O) — model ${modelId}, budget ${startBudget}${escalated}\n` +
			`  Task: ${options.task}\n` +
			`  Decision: ${shown}\n` +
			`  Raw: ${JSON.stringify(result.raw.content)} (finish: ${result.raw.finishReason})\n`,
	);
}
