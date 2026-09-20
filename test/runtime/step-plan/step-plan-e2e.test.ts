/**
 * Simulated end-to-end drive of the step-planning stage — aimock-style scripted model responses, REAL runner, REAL
 * controller, REAL tools (submit_step_plan / submit_step_plan_review / complete_step / lookup), REAL pure cores, a
 * fake sandbox (acceptance commands answer from a script) and a fake network (lookup fetch answers from fixtures).
 * No Docker, no LM Studio, nothing leaves the machine.
 *
 *   plan (flawed: a fact from memory) → review REVISES (fact_from_memory) → plan resubmits with a verify block →
 *   review APPROVES → step "flag" accepted → step "print" is a verify step: complete_step without a citation is
 *   refused → lookup (search + fetch, receipts) → complete_step with the citation advances → step "test" fails its
 *   acceptance twice → REPLAN (history carries the failure; done steps are not redone) → review approves →
 *   the replanned step passes → DELIVER. Then a review bounce replans again with the reviewer's feedback.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ recordSelfObservation: vi.fn() }));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: h.recordSelfObservation }));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => []),
}));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({ createSessionId: (id: string) => id }));

import { createLookupReceiptStore } from "../../../src/nklein-agent/lookup-receipt-store";
import { hashWorkspacePathForLedger } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { createLookupClient } from "../../../src/nklein-agent/nklein-lookup-client";
import { createNKleinLookupTool, type NKleinLookupOutput } from "../../../src/nklein-agent/nklein-lookup-tool";
import { createStepPlanController } from "../../../src/nklein-agent/nklein-step-plan-controller";
import { createNKleinStepPlanReviewTool } from "../../../src/nklein-agent/nklein-step-plan-review-tool";
import { createStepPlanRunner, type StepPlanRunnerDeps } from "../../../src/nklein-agent/nklein-step-plan-runner";
import { createNKleinStepPlanTool } from "../../../src/nklein-agent/nklein-step-plan-tool";
import { createStepPlanStore } from "../../../src/nklein-agent/step-plan-store";

const fakeCheckHost = async (url: string) => (/127\.0\.0\.1|localhost|10\./.test(url) ? "private address" : null);
const CTX = { agentId: "sim", iteration: 1 };
const CARD = "card-json-flag";
const REPO = "/repo/project";

function step(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		title: `Step ${id}`,
		intent: `Do ${id}.`,
		files: [{ path: `src/${id}.ts`, change: `implement ${id}` }],
		expectedOutcome: `${id} done`,
		acceptance: { command: `check-${id}`, check: `${id} passes` },
		mustNot: ["touch tests"],
		difficulty: "easy",
		...extra,
	};
}

/** The scripted planner: what a real model would submit, keyed on what the seed prompt asks for. */
function plannerScript(seed: string) {
	if (seed.includes("REPLAN request")) {
		// Revision 1: the replan brief names the failing step; the planner replaces it and keeps the done ones out.
		return {
			objective: "add --json",
			steps: [step("test2", { acceptance: { command: "check-test2", check: "tests pass" } })],
		};
	}
	if (seed.includes("REVISION requested")) {
		return {
			objective: "add --json",
			steps: [
				step("flag"),
				step("print", {
					verify: { claim: "JSON.stringify accepts a replacer array", query: "JSON.stringify replacer array" },
					acceptance: { command: null, check: "prints JSON" },
				}),
				step("test"),
			],
		};
	}
	// Initial (flawed) plan: step "print" states a fact from memory with no verify block.
	return {
		objective: "add --json",
		steps: [step("flag"), step("print", { acceptance: { command: null, check: "prints JSON" } }), step("test")],
	};
}

describe("step planning — simulated e2e: plan → review → replan → execute (+ verify with lookup receipt)", () => {
	// Created synchronously at describe time: the stores below are built while the suite is collected, so a
	// beforeAll-assigned root would leave them pointing at "" (the cwd) and receipts would leak across runs.
	const root = mkdtempSync(join(tmpdir(), "nklein-stepplan-e2e-"));
	const acceptanceScript = new Map<string, number[]>([
		["check-flag", [0]],
		["check-test", [1, 1]],
		["check-test2", [0]],
	]);
	const acceptanceCalls: string[] = [];
	const sessions: Array<{ id: string; prompt: string }> = [];
	let reviewRound = 0;

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const lookupStore = createLookupReceiptStore(root);
	const controllerRef: { current: ReturnType<typeof createStepPlanController> | null } = { current: null };

	function buildLookupTool(sessionId: string, cardId: string) {
		return createNKleinLookupTool({
			client: createLookupClient({
				proxyUrl: `http://${encodeURIComponent(sessionId)}:tok@127.0.0.1:1/`,
				grantHost: async () => true,
				checkHost: fakeCheckHost,
				fetchImpl: async (url) => ({
					status: 200,
					finalUrl: url,
					contentType: "text/html",
					body: new TextEncoder().encode(
						url.includes("duckduckgo")
							? `<div class="result web-result"><a class="result__a" href="https://developer.mozilla.org/replacer">JSON.stringify() - MDN</a><div class="result__snippet">The replacer parameter can be an array.</div></div>`
							: "<html><title>JSON.stringify()</title><body><p>replacer: an array of strings and numbers.</p></body></html>",
					),
					truncated: false,
				}),
			}),
			store: lookupStore,
			workspaceHash: "ws",
			cardId,
			currentStepId: () => controllerRef.current?.currentStepId(cardId) ?? null,
			onReceipt: (receipt) => controllerRef.current?.noteReceipt(cardId, receipt),
		});
	}

	const startRuntimeSession: StepPlanRunnerDeps["startRuntimeSession"] = async (input) => {
		sessions.push({ id: input.taskId, prompt: input.prompt });
		if (input.taskId.endsWith("::step-plan")) {
			// The planner goes through the REAL submit tool (schema + structural validation), like the SDK would.
			const tool = createNKleinStepPlanTool({ onSubmitted: input.onStepPlanSubmitted });
			const result = (await tool.execute(plannerScript(input.prompt), CTX)) as { ok: boolean };
			expect(result.ok).toBe(true);
		} else if (input.taskId.endsWith("::step-plan-review")) {
			reviewRound += 1;
			const tool = createNKleinStepPlanReviewTool({ onSubmitted: input.onStepPlanReviewSubmitted });
			const verdict =
				reviewRound === 1
					? {
							verdict: "revise",
							summary: "one fact stated from memory",
							findings: [
								{
									category: "fact_from_memory",
									stepId: "print",
									fix: "add verify{claim, query} for the replacer-array claim",
								},
							],
						}
					: { verdict: "approve", summary: "every step executable" };
			expect(((await tool.execute(verdict, CTX)) as { ok: boolean }).ok).toBe(true);
		}
		return { result: {} };
	};

	const runner = createStepPlanRunner({
		getAgentSandboxManager: () => ({}) as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "qwen3.6-27b", workspaceRoot: REPO }) as never,
		getPauseController: () => ({}) as never,
		getHarness: () =>
			({
				runBracketed: async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) =>
					drive({
						workspace: { workdir: "/sandbox/wd" },
						deadlineMs: Date.now() + 60_000,
						runBoundedTurn: async (turn: Promise<unknown>) => void (await turn),
					}),
			}) as never,
		startRuntimeSession,
		sendTaskSessionInput: async () => {},
		pickEscalationModel: async () => ({ providerId: "lmstudio", modelId: "qwen3.8-27b" }),
		buildLookupTool,
		defaultTimeoutMs: 60_000,
		maxNudges: 1,
		env: {},
	});

	const controller = createStepPlanController({
		runner,
		getStore: () => createStepPlanStore(root),
		runStepAcceptance: async (_taskId, command) => {
			acceptanceCalls.push(command);
			const script = acceptanceScript.get(command) ?? [0];
			const exitCode = script.shift() ?? 0;
			return { exitCode, output: exitCode === 0 ? "ok" : `FAIL ${command}: 1 test failed` };
		},
		getBaseRef: () => "base-1",
		lookupAvailable: () => true,
		env: { NKLEIN_STEP_PLAN_MAX_STEP_ATTEMPTS: "2", NKLEIN_STEP_PLAN_MAX_REPLANS: "2" },
	});
	controllerRef.current = controller;

	it("drives the card through plan → review(revise) → review(approve) → steps → replan → deliver", async () => {
		// 1. Plan + review before the worker starts.
		const startPrompt = await controller.prepareStart({
			taskId: CARD,
			projectRepoPath: REPO,
			taskTitle: "Add --json",
			taskPrompt: "Add a --json flag to the CLI that prints the report as JSON.",
			filesLikelyTouched: ["src/cli.ts"],
		});
		expect(sessions.map((session) => session.id)).toEqual([
			`${CARD}::step-plan`,
			`${CARD}::step-plan-review`,
			`${CARD}::step-plan`,
			`${CARD}::step-plan-review`,
		]);
		expect(sessions[2].prompt).toContain("[fact_from_memory] step print: add verify{claim, query}");
		expect(startPrompt).toContain("step 1 of 3: flag");
		expect(startPrompt).toContain("Never assert an API signature");
		expect(controller.hasPlan(CARD)).toBe(true);

		// 2. The worker executes ONE step at a time through complete_step.
		const completeStep = controller.buildCompleteStepTool(CARD);
		expect(completeStep).not.toBeNull();
		if (!completeStep) throw new Error("unreachable");

		const first = (await completeStep.execute({ stepId: "flag", note: "added the flag" }, CTX)) as {
			ok: boolean;
			next: string;
			instruction: string;
		};
		expect(first).toMatchObject({ ok: true, accepted: "flag", next: "print" });
		expect(acceptanceCalls).toEqual(["check-flag"]);
		expect(first.instruction).toContain("step 2 of 3: print");
		expect(first.instruction).toContain('Call lookup with the query "JSON.stringify replacer array"');

		// 3. A verify step without a receipt-backed citation is refused …
		const refused = (await completeStep.execute({ stepId: "print", note: "done" }, CTX)) as {
			ok: boolean;
			instruction: string;
		};
		expect(refused.ok).toBe(false);
		expect(refused.instruction).toContain("verify step");

		// … so the worker looks the fact up (search → fetch; receipts recorded for THIS card and step) …
		const lookup = buildLookupTool(CARD, CARD);
		const search = (await lookup.execute({ query: "JSON.stringify replacer array" }, CTX)) as NKleinLookupOutput;
		expect(search).toMatchObject({ ok: true, mode: "search" });
		const page = (await lookup.execute({ url: "https://developer.mozilla.org/replacer" }, CTX)) as NKleinLookupOutput;
		expect(page).toMatchObject({ ok: true, mode: "fetch", title: "JSON.stringify()" });
		const receipts = await lookupStore.readReceipts("ws");
		expect(receipts.map((receipt) => [receipt.kind, receipt.cardId, receipt.stepId])).toEqual([
			["search", CARD, "print"],
			["fetch", CARD, "print"],
		]);
		expect(receipts.every((receipt) => receipt.sha256.length === 64 && receipt.bytes > 0)).toBe(true);

		// … and completes the step with the citation.
		const verified = (await completeStep.execute(
			{ stepId: "print", note: "verified on MDN", citations: ["https://developer.mozilla.org/replacer"] },
			CTX,
		)) as { ok: boolean; next: string };
		expect(verified).toMatchObject({ ok: true, accepted: "print", next: "test" });

		// 4. Step "test" fails its acceptance: one retry, then the bound triggers a REPLAN through review again.
		const retry = (await completeStep.execute({ stepId: "test", note: "wrote tests" }, CTX)) as {
			ok: boolean;
			instruction: string;
		};
		expect(retry.ok).toBe(false);
		expect(retry.instruction).toContain("attempt 1/2");
		expect(retry.instruction).toContain("FAIL check-test");
		const sessionsBefore = sessions.length;
		const replanned = (await completeStep.execute({ stepId: "test", note: "tried again" }, CTX)) as {
			ok: boolean;
			replanned: boolean;
			instruction: string;
		};
		expect(replanned).toMatchObject({ ok: true, replanned: true });
		expect(sessions.slice(sessionsBefore).map((session) => session.id)).toEqual([
			`${CARD}::step-plan`,
			`${CARD}::step-plan-review`,
		]);
		const replanSeed = sessions[sessionsBefore].prompt;
		expect(replanSeed).toContain("REPLAN request, revision 1");
		expect(replanSeed).toContain("a step failed its acceptance repeatedly (step test)");
		expect(replanSeed).toContain("Steps already DONE and accepted");
		expect(replanSeed).toContain("- flag — Step flag");
		expect(replanSeed).toContain("- print — Step print");
		expect(replanned.instruction).toContain("step 1 of 1: test2");

		// 5. The replanned step passes → deliver; the persisted plan records the whole history.
		const done = (await completeStep.execute({ stepId: "test2", note: "green" }, CTX)) as {
			ok: boolean;
			next: null;
			instruction: string;
		};
		expect(done).toMatchObject({ ok: true, accepted: "test2", next: null });
		expect(done.instruction).toContain("All planned steps are accepted");
		const persisted = await createStepPlanStore(root).read(hashWorkspacePathForLedger(REPO), CARD);
		expect(persisted).toMatchObject({ revision: 1, status: "completed" });
		expect(persisted?.history).toHaveLength(1);
		expect(persisted?.history[0]).toMatchObject({ trigger: "step_failed", completedStepIds: ["flag", "print"] });
		expect(acceptanceCalls).toEqual(["check-flag", "check-test", "check-test", "check-test2"]);
	});

	it("a delivery-review bounce replans (through review) with the reviewer's feedback and hands back a step", async () => {
		const before = sessions.length;
		const prompt = await controller.onReviewBounce(CARD, "The JSON output is missing the `total` field.");
		expect(prompt).toContain("step 1 of 1: test2");
		const seed = sessions[before].prompt;
		expect(seed).toContain("REPLAN request, revision 2");
		expect(seed).toContain("the delivery review requested changes");
		expect(seed).toContain("missing the `total` field");
		expect(seed).toContain("Lessons from earlier revisions");
	});

	it("the replan budget is bounded: a third replan is refused and the card falls back", async () => {
		expect(await controller.onUserSteer(CARD, "also add --yaml")).toBeNull();
		expect(controller.hasPlan(CARD)).toBe(false);
		const last = h.recordSelfObservation.mock.calls.at(-1)?.[0];
		expect(last.metadata).toMatchObject({
			category: "step_plan",
			phase: "replan",
			outcome: "exhausted",
			trigger: "user_steer",
		});
	});
});
