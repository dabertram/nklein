import { describe, expect, it, vi } from "vitest";
import {
	buildExplorerSeedPrompt,
	createNKleinExplorerCitationsTool,
	createNKleinExploreTool,
	type NKleinExplorerResult,
	renderExplorerResultForWorker,
} from "../../../src/nklein-agent/nklein-explorer-tool";
import type { AgentToolContext } from "../../../src/nklein-agent/sdk-agent-types";

const toolContext = {} as AgentToolContext;

describe("nklein-explorer-tool (F11.2j)", () => {
	it("submit_citations parses a valid submission (tolerating a name echo) and reports it once", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinExplorerCitationsTool({ onSubmitted });
		const result = await tool.execute(
			{
				name: "submit_citations",
				answer: "Routing is decided in the task router.",
				citations: [
					{ path: "src/nklein-agent/nklein-task-router.ts", line: 218, note: "routeNKleinTask entry" },
					{ path: "src/trpc/runtime-api/start-task-session.ts", note: "caller assembles candidates" },
				],
			},
			toolContext,
		);
		expect(result).toMatchObject({ ok: true });
		expect(onSubmitted).toHaveBeenCalledExactlyOnceWith({
			answer: "Routing is decided in the task router.",
			citations: [
				{ path: "src/nklein-agent/nklein-task-router.ts", line: 218, note: "routeNKleinTask entry" },
				{ path: "src/trpc/runtime-api/start-task-session.ts", line: null, note: "caller assembles candidates" },
			],
		});
	});

	it("submit_citations rejects an empty/malformed submission with a recoverable error", async () => {
		const onSubmitted = vi.fn();
		const tool = createNKleinExplorerCitationsTool({ onSubmitted });
		const result = (await tool.execute({ answer: "", citations: [] }, toolContext)) as { error?: string };
		expect(result.error).toContain("submit_citations");
		expect(onSubmitted).not.toHaveBeenCalled();
	});

	it("the seed brief embeds the question and the read-only + submit contract", () => {
		const seed = buildExplorerSeedPrompt("Where is the acceptance gate?");
		expect(seed).toContain("Where is the acceptance gate?");
		expect(seed).toContain("READ-ONLY");
		expect(seed).toContain("submit_citations");
	});

	it("renders findings citation-first and the explore tool degrades honestly on a null run", async () => {
		const findings: NKleinExplorerResult = {
			answer: "It lives in the verifier.",
			citations: [{ path: "src/a.ts", line: 12, note: "the gate" }],
		};
		expect(renderExplorerResultForWorker(findings)).toContain("src/a.ts:12 — the gate");
		const okTool = createNKleinExploreTool(async () => findings);
		expect(await okTool.execute({ question: "where?" }, toolContext)).toMatchObject({
			findings: expect.stringContaining("src/a.ts:12"),
		});
		const failTool = createNKleinExploreTool(async () => null);
		const failed = (await failTool.execute({ question: "where?" }, toolContext)) as { error?: string };
		expect(failed.error).toContain("Fall back");
		const emptyQuestion = (await okTool.execute({ question: "  " }, toolContext)) as { error?: string };
		expect(emptyQuestion.error).toContain("non-empty");
	});
});
