import { describe, expect, it } from "vitest";
import { createSimulatorServer } from "../src/server.js";
import type { ScenarioScript } from "../src/scenario/track-types.js";

const script: ScenarioScript = {
	name: "integration",
	seed: 1,
	tracks: [
		{
			id: "perfect-decompose",
			requestClass: "decompose",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "demo",
									spec: "s",
									plan: "p",
									tasks: [{ id: "card-1", title: "First", prompt: "do it" }],
								},
							},
						],
					},
				},
			],
		},
		{
			id: "perfect-worker-first",
			requestClass: "worker",
			userMessageIncludes: "First",
			turns: [
				{ behavior: { kind: "tool_calls", calls: [{ name: "read_files", arguments: { paths: ["spec.md"] } }] } },
				{ behavior: { kind: "text", content: "Done with First.", reasoning: "thought about it" } },
			],
			repeatLastTurn: true,
		},
		{
			id: "t-429-rate",
			requestClass: "chat",
			userMessageIncludes: "rate me",
			turns: [{ behavior: { kind: "http_error", status: 429, message: "slow down", retryAfterSeconds: 7 } }],
		},
	],
};

async function post(base: string, body: unknown): Promise<Response> {
	return fetch(`${base}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("createSimulatorServer (aimock transport integration)", () => {
	it("classifies by offered tools, scripts multi-turn workers, and injects transport errors", async () => {
		const server = createSimulatorServer(script);
		await server.start();
		try {
			const base = server.url();

			// Decompose class: recognized via the OFFERED decompose_project tool; answers with the tool call.
			const decompose = await (
				await post(base, {
					model: "sim",
					messages: [
						{ role: "system", content: "You plan projects." },
						{ role: "user", content: "Please decompose" },
					],
					tools: [{ type: "function", function: { name: "decompose_project", parameters: { type: "object" } } }],
				})
			).json();
			const call = decompose.choices[0].message.tool_calls[0];
			expect(call.function.name).toBe("decompose_project");
			// Arguments arrive as a JSON STRING (the production wire shape !Klein parses).
			expect(typeof call.function.arguments).toBe("string");
			expect(JSON.parse(call.function.arguments).tasks[0].id).toBe("card-1");

			// Multi-turn conditioning follows the TRANSCRIPT SHAPE (assistant-message count = per-session turn
			// index), exactly like a real agent loop that appends each response before re-asking. A restarted
			// session (fresh transcript) deterministically starts back at turn 1 — restart-idempotent by design.
			const seedMessages = [
				{ role: "system", content: "Follow the efficiency rules of the kanban." },
				{ role: "user", content: "Work the card: First" },
			];
			const turn1 = await (await post(base, { model: "sim", messages: seedMessages })).json();
			expect(turn1.choices[0].message.tool_calls[0].function.name).toBe("read_files");
			const grownMessages = [
				...seedMessages,
				{ role: "assistant", content: null, tool_calls: turn1.choices[0].message.tool_calls },
				{ role: "tool", content: "file contents here" },
			];
			const turn2 = await (await post(base, { model: "sim", messages: grownMessages })).json();
			expect(turn2.choices[0].message.content).toBe("Done with First.");
			expect(turn2.choices[0].message.reasoning_content).toBe("thought about it");
			const turn3 = await (
				await post(base, {
					model: "sim",
					messages: [...grownMessages, { role: "assistant", content: "Done with First." }, { role: "user", content: "and now?" }],
				})
			).json();
			expect(turn3.choices[0].message.content).toBe("Done with First.");
			// A RESTARTED session (fresh transcript) re-serves turn 1 instead of resuming mid-ladder.
			const restarted = await (await post(base, { model: "sim", messages: seedMessages })).json();
			expect(restarted.choices[0].message.tool_calls[0].function.name).toBe("read_files");

			// Transport failure track: 429 with Retry-After.
			const rated = await post(base, {
				model: "sim",
				messages: [{ role: "user", content: "rate me please" }],
			});
			expect(rated.status).toBe(429);
			expect(rated.headers.get("retry-after")).toBe("7");
		} finally {
			await server.stop();
		}
	});
});
