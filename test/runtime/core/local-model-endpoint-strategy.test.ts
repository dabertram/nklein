import { describe, expect, it } from "vitest";
import {
	LOCAL_MODEL_ENDPOINT_LADDER,
	type LocalModelEndpointKind,
	nextEndpointStrategy,
	orderEndpointStrategies,
} from "../../../src/core/local-model-endpoint-strategy";

describe("local model endpoint strategy", () => {
	it("defaults to the canonical ladder order (OpenAI → native → Anthropic)", () => {
		expect(orderEndpointStrategies()).toEqual(["openai", "native_v1_chat", "anthropic_messages"]);
		expect([...LOCAL_MODEL_ENDPOINT_LADDER]).toEqual(["openai", "native_v1_chat", "anthropic_messages"]);
	});

	it("promotes a learned winner to the front without repeating it", () => {
		expect(orderEndpointStrategies({ preferredKind: "anthropic_messages" })).toEqual([
			"anthropic_messages",
			"openai",
			"native_v1_chat",
		]);
		expect(orderEndpointStrategies({ preferredKind: "native_v1_chat" })).toEqual([
			"native_v1_chat",
			"openai",
			"anthropic_messages",
		]);
	});

	it("keeps the canonical order when the preferred kind is already first", () => {
		expect(orderEndpointStrategies({ preferredKind: "openai" })).toEqual([
			"openai",
			"native_v1_chat",
			"anthropic_messages",
		]);
	});

	it("gates to available kinds and preserves canonical relative order", () => {
		expect(orderEndpointStrategies({ availableKinds: ["anthropic_messages", "openai"] })).toEqual([
			"openai",
			"anthropic_messages",
		]);
	});

	it("ignores a stale preference for a now-unavailable kind", () => {
		expect(
			orderEndpointStrategies({ availableKinds: ["openai", "native_v1_chat"], preferredKind: "anthropic_messages" }),
		).toEqual(["openai", "native_v1_chat"]);
	});

	it("ignores unknown/duplicate kinds in the available set", () => {
		const dirty = ["openai", "openai", "bogus"] as unknown as LocalModelEndpointKind[];
		expect(orderEndpointStrategies({ availableKinds: dirty })).toEqual(["openai"]);
	});

	it("returns an empty order only when no kind is available", () => {
		expect(orderEndpointStrategies({ availableKinds: [] })).toEqual([]);
	});

	it("walks the ladder one hop at a time and exhausts to null", () => {
		const input = {} as const;
		expect(nextEndpointStrategy([], input)).toBe("openai");
		expect(nextEndpointStrategy(["openai"], input)).toBe("native_v1_chat");
		expect(nextEndpointStrategy(["openai", "native_v1_chat"], input)).toBe("anthropic_messages");
		expect(nextEndpointStrategy(["openai", "native_v1_chat", "anthropic_messages"], input)).toBeNull();
	});

	it("next hop respects a learned winner first", () => {
		expect(nextEndpointStrategy([], { preferredKind: "anthropic_messages" })).toBe("anthropic_messages");
		expect(nextEndpointStrategy(["anthropic_messages"], { preferredKind: "anthropic_messages" })).toBe("openai");
	});
});
