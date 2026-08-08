import { describe, expect, it } from "vitest";
import { MAX_ACTION_PLAN_STEPS } from "../../../src/core/action-plan-ir";
import {
	buildActionPlanResponseSchema,
	buildActionPlanRuntimePrompt,
	parseActionPlanCandidate,
	parseActionPlanJson,
} from "../../../src/core/action-plan-producer";

/**
 * Coverage for a module the P20.3b ablation sweep found had NO exercising test (2026-08-08).
 *
 * This is the boundary where a LOCAL MODEL's output becomes something the runtime will execute, so its job is
 * refusal: a plan naming a tool that was never offered, or malformed JSON, must come back as `plan: null` with
 * a usable reason. The dangerous direction is admitting a bad plan, not rejecting a good one — a step whose
 * `tool` is hallucinated would otherwise reach the executor.
 *
 * The tests therefore concentrate on what must be REFUSED, and on the error text being specific enough for the
 * model to correct itself.
 */
const TOOLS = ["read_file", "create_card"];
const step = (over: Record<string, unknown> = {}) => ({
	id: "s1",
	tool: "read_file",
	args: { path: "a.ts" },
	dependsOn: [],
	...over,
});

describe("parseActionPlanCandidate", () => {
	it("accepts a well-formed plan over offered tools", () => {
		const result = parseActionPlanCandidate({ steps: [step()] }, TOOLS);
		expect(result.errors).toEqual([]);
		expect(result.plan?.steps).toHaveLength(1);
	});

	it("REFUSES a step naming a tool that was never offered, and names the tool", () => {
		// The hallucination case this boundary exists for. The message must carry the offending name, or the
		// model has nothing to correct — a bare "invalid plan" sends it round the same loop.
		const result = parseActionPlanCandidate({ steps: [step({ tool: "rm_rf" })] }, TOOLS);
		expect(result.plan).toBeNull();
		expect(result.errors.join(" ")).toMatch(/not in the offered manifest: rm_rf/);
	});

	it("reports an unknown tool ONCE even when several steps use it", () => {
		// Duplicate errors bloat a correction prompt with no added information, and the module deliberately
		// de-duplicates — a behaviour no single-step fixture can observe.
		const result = parseActionPlanCandidate(
			{ steps: [step({ id: "a", tool: "ghost" }), step({ id: "b", tool: "ghost" })] },
			TOOLS,
		);
		const mentions = result.errors.filter((error) => error.includes("ghost"));
		expect(mentions).toHaveLength(1);
	});

	it("reports EVERY distinct unknown tool, not just the first", () => {
		const result = parseActionPlanCandidate(
			{ steps: [step({ id: "a", tool: "ghostA" }), step({ id: "b", tool: "ghostB" })] },
			TOOLS,
		);
		expect(result.errors.join(" ")).toMatch(/ghostA/);
		expect(result.errors.join(" ")).toMatch(/ghostB/);
	});

	it("refuses a plan that exceeds the step cap", () => {
		const steps = Array.from({ length: MAX_ACTION_PLAN_STEPS + 1 }, (_, index) => step({ id: `s${index}` }));
		const result = parseActionPlanCandidate({ steps }, TOOLS);
		expect(result.plan).toBeNull();
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("refuses structurally wrong input with a PATHED message rather than a bare failure", () => {
		// The path is what makes a schema error correctable; `steps.0.tool: ...` tells the model where to look.
		const result = parseActionPlanCandidate({ steps: [{ id: "s1", args: {} }] }, TOOLS);
		expect(result.plan).toBeNull();
		expect(result.errors.join(" ")).toMatch(/steps/);
	});

	it("refuses a non-object payload without throwing", () => {
		for (const value of [null, undefined, 42, "a plan", []]) {
			const result = parseActionPlanCandidate(value, TOOLS);
			expect(result.plan).toBeNull();
			expect(result.errors.length).toBeGreaterThan(0);
		}
	});

	it("returns plan AND errors consistently — never a plan alongside errors", () => {
		// The contract callers rely on: a non-null plan means it is safe to execute. A plan returned beside
		// errors would let a caller checking only `plan` run a rejected plan.
		const bad = parseActionPlanCandidate({ steps: [step({ tool: "ghost" })] }, TOOLS);
		expect(bad.plan === null && bad.errors.length > 0).toBe(true);
		const good = parseActionPlanCandidate({ steps: [step()] }, TOOLS);
		expect(good.plan !== null && good.errors.length === 0).toBe(true);
	});
});

describe("parseActionPlanJson", () => {
	it("parses a JSON string and applies the same manifest check", () => {
		expect(parseActionPlanJson(JSON.stringify({ steps: [step()] }), TOOLS).plan).not.toBeNull();
		expect(parseActionPlanJson(JSON.stringify({ steps: [step({ tool: "ghost" })] }), TOOLS).plan).toBeNull();
	});

	it("turns malformed JSON into an error rather than a throw", () => {
		// A local model emitting prose or a truncated object must not crash the turn; the reason has to say the
		// response was not JSON, so the retry note can ask for the constrained object.
		for (const content of ["", "not json", '{"steps": [', "Here is the plan: {}"]) {
			const result = parseActionPlanJson(content, TOOLS);
			expect(result.plan).toBeNull();
			expect(result.errors.join(" ")).toMatch(/not JSON/i);
		}
	});
});

describe("buildActionPlanResponseSchema", () => {
	it("constrains the tool field to exactly the offered tools", () => {
		// The schema is what a constrained-decode backend enforces, so the allowed set must reach it — otherwise
		// the only defence against a hallucinated tool is the post-hoc check above.
		const schema = JSON.stringify(buildActionPlanResponseSchema(TOOLS));
		expect(schema).toMatch(/read_file/);
		expect(schema).toMatch(/create_card/);
		expect(schema).not.toMatch(/rm_rf/);
	});

	it("forbids additional properties, so a model cannot smuggle extra fields", () => {
		expect(buildActionPlanResponseSchema(TOOLS).additionalProperties).toBe(false);
	});
});

describe("buildActionPlanRuntimePrompt", () => {
	it("lists every offered tool with its description and args schema", () => {
		const prompt = buildActionPlanRuntimePrompt([
			{ name: "read_file", description: "read a file", inputSchema: { type: "object" } },
			{ name: "create_card", description: "make a card", inputSchema: { type: "object" } },
		]);
		expect(prompt).toMatch(/read_file: read a file/);
		expect(prompt).toMatch(/create_card: make a card/);
		expect(prompt).toMatch(/args schema/);
	});

	it("states the step budget from the shared constant, not a hard-coded number", () => {
		// If the cap ever moves, a prompt carrying a stale literal quietly asks for plans the parser will refuse.
		expect(buildActionPlanRuntimePrompt([])).toMatch(new RegExp(`1-${MAX_ACTION_PLAN_STEPS} steps`));
	});

	it("tells the model not to repeat completed effects — the partial-success rule", () => {
		expect(buildActionPlanRuntimePrompt([])).toMatch(/never repeat completed effects/i);
	});
});
