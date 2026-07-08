import { describe, expect, it, vi } from "vitest";
import { iterateEndpointStrategies } from "../../../src/core/endpoint-iteration-loop";
import type { LocalModelEndpointKind } from "../../../src/core/local-model-endpoint-strategy";

describe("endpoint-iteration loop (§5.AB)", () => {
	it("returns the first usable kind in canonical order and stops there", async () => {
		const attempt = vi.fn(async (kind: LocalModelEndpointKind) => kind === "native_v1_chat");
		const result = await iterateEndpointStrategies({ attempt });
		// openai tried (not usable) → native_v1_chat usable → stop (anthropic_messages never tried).
		expect(result.winningKind).toBe("native_v1_chat");
		expect(result.attempts.map((a) => a.kind)).toEqual(["openai", "native_v1_chat"]);
		expect(attempt).toHaveBeenCalledTimes(2);
	});

	it("honors a learned preferredKind (tried first)", async () => {
		const attempt = vi.fn(async () => true);
		const result = await iterateEndpointStrategies({ preferredKind: "anthropic_messages", attempt });
		expect(result.winningKind).toBe("anthropic_messages");
		expect(result.attempts).toEqual([{ kind: "anthropic_messages", usable: true }]);
	});

	it("records a thrown attempt as not-usable and continues the ladder", async () => {
		const attempt = vi.fn(async (kind: LocalModelEndpointKind) => {
			if (kind === "openai") {
				throw new Error("connection refused");
			}
			return kind === "anthropic_messages";
		});
		const result = await iterateEndpointStrategies({ attempt });
		expect(result.winningKind).toBe("anthropic_messages");
		expect(result.attempts[0]).toMatchObject({ kind: "openai", usable: false, error: "connection refused" });
		expect(result.attempts.map((a) => a.kind)).toEqual(["openai", "native_v1_chat", "anthropic_messages"]);
	});

	it("returns winningKind null when every eligible kind fails", async () => {
		const attempt = vi.fn(async () => false);
		const result = await iterateEndpointStrategies({ availableKinds: ["openai", "native_v1_chat"], attempt });
		expect(result.winningKind).toBeNull();
		expect(result.attempts.map((a) => a.kind)).toEqual(["openai", "native_v1_chat"]);
	});
});
