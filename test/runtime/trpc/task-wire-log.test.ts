import { describe, expect, it } from "vitest";
import { collectTaskWireLog, wireLogSessionIdsForTask } from "../../../src/trpc/runtime-api/task-wire-log";

function request(recordedAt: string, overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1 as const,
		sessionId: "card-1",
		source: "sdk_model_wrapper" as const,
		purpose: "worker_turn",
		modelId: "qwen3.8-27b-mlx",
		recordedAt,
		messages: [
			{ role: "system", content: "you are a worker" },
			{ role: "user", content: "do the thing" },
		],
		messagesSha256: `hash-${recordedAt}`,
		...overrides,
	};
}
function injection(recordedAt: string, kind = "focus_chain_rail") {
	return { schemaVersion: 1 as const, sessionId: "card-1", kind, role: "user", content: "rail text", recordedAt };
}

describe("collectTaskWireLog", () => {
	it("covers the card's derived sessions, not just the primary one", () => {
		// A card's story is incomplete without its reviewer's requests.
		expect(wireLogSessionIdsForTask("card-1")).toEqual(["card-1", "card-1::review", "card-1::spec"]);
	});

	it("summarises without text by default, and includes verbatim text only when asked", async () => {
		const base = await collectTaskWireLog(
			{ taskId: "card-1" },
			{
				readRequests: async (id) => (id === "card-1" ? [request("2026-08-20T10:00:00.000Z")] : []),
				readInjections: async () => [],
				requestLogEnabled: () => true,
				injectionLogEnabled: () => true,
			},
		);
		expect(base.requests[0]?.messageCount).toBe(2);
		// The SIZE signal survives even when the content does not — that is what makes the summary useful.
		expect(base.requests[0]?.totalChars).toBe("you are a worker".length + "do the thing".length);
		expect(base.requests[0]?.messages[0]?.text).toBeUndefined();

		const verbose = await collectTaskWireLog(
			{ taskId: "card-1", includeMessageText: true },
			{
				readRequests: async (id) => (id === "card-1" ? [request("2026-08-20T10:00:00.000Z")] : []),
				readInjections: async () => [],
				requestLogEnabled: () => true,
				injectionLogEnabled: () => true,
			},
		);
		expect(verbose.requests[0]?.messages[1]?.text).toBe("do the thing");
	});

	it("reports a DISABLED log distinctly from an empty one", async () => {
		// Silence must stay attributable: "nothing was recorded" and "recording is off" are different facts,
		// and conflating them is how an empty panel gets read as an empty session.
		const disabled = await collectTaskWireLog(
			{ taskId: "card-1" },
			{
				readRequests: async () => [],
				readInjections: async () => [],
				requestLogEnabled: () => false,
				injectionLogEnabled: () => false,
			},
		);
		expect(disabled).toMatchObject({ requests: [], requestLogDisabled: true, injectionLogDisabled: true });

		const empty = await collectTaskWireLog(
			{ taskId: "card-1" },
			{
				readRequests: async () => [],
				readInjections: async () => [],
				requestLogEnabled: () => true,
				injectionLogEnabled: () => true,
			},
		);
		expect(empty).toMatchObject({ requests: [], requestLogDisabled: false, injectionLogDisabled: false });
	});

	it("keeps the newest entries and REPORTS what it dropped", async () => {
		const many = Array.from({ length: 5 }, (_, index) => request(`2026-08-20T10:0${index}:00.000Z`));
		const result = await collectTaskWireLog(
			{ taskId: "card-1", limit: 2 },
			{
				readRequests: async (id) => (id === "card-1" ? many : []),
				readInjections: async (id) => (id === "card-1" ? [injection("2026-08-20T10:00:00.000Z")] : []),
				requestLogEnabled: () => true,
				injectionLogEnabled: () => true,
			},
		);
		expect(result.requests).toHaveLength(2);
		expect(result.requests.at(-1)?.recordedAt).toBe("2026-08-20T10:04:00.000Z");
		// A capped view must never read as a complete one.
		expect(result.truncatedRequests).toBe(3);
		expect(result.truncatedInjections).toBe(0);
	});

	it("merges sessions in chronological order so the card reads as one story", async () => {
		const result = await collectTaskWireLog(
			{ taskId: "card-1" },
			{
				readRequests: async (id) =>
					id === "card-1"
						? [request("2026-08-20T10:00:00.000Z")]
						: id === "card-1::review"
							? [request("2026-08-20T09:00:00.000Z", { sessionId: "card-1::review", purpose: "review" })]
							: [],
				readInjections: async () => [],
				requestLogEnabled: () => true,
				injectionLogEnabled: () => true,
			},
		);
		expect(result.requests.map((entry) => entry.purpose)).toEqual(["review", "worker_turn"]);
	});
});
