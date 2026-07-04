import { describe, expect, it } from "vitest";
import {
	classifyFailureSignature,
	FAILURE_SIGNATURES,
	type FailureSignatureKind,
	isRemediableFailure,
} from "../../../src/core/failure-signature";
import { MODEL_FAILURE_KINDS } from "../../../src/core/model-behavior-profile";
import { retryLadderForOutcome } from "../../../src/core/retry-policy";

describe("classifyFailureSignature — model-unavailable (not a capability failure)", () => {
	it.each([
		"Model not found: qwen3-8b",
		"MODEL_NOT_FOUND",
		"No model loaded on the endpoint",
		"Failed to load model into memory",
		"connect ECONNREFUSED 127.0.0.1:1234",
		"getaddrinfo ENOTFOUND localhost",
		"HTTP 404 Not Found",
	])("routes %j to model_unavailable / other_failure / NON-remediable", (message) => {
		const verdict = classifyFailureSignature(new Error(message));
		expect(verdict.signature).toBe("model_unavailable");
		expect(verdict.outcome).toBe("other_failure");
		expect(verdict.remediable).toBe(false);
	});

	it.each([
		"file not found: config.json",
		"table not found",
		"key not found in map",
	])("does NOT misclassify a generic 'not found' (%j) as a gone endpoint — safe retries stay allowed", (message) => {
		// A bare "not found" needle used to match any error → model_unavailable / remediable:false, suppressing
		// otherwise-safe retries. Only model/endpoint needles (model not found / model_not_found / 404) qualify.
		const verdict = classifyFailureSignature(new Error(message));
		expect(verdict.signature).not.toBe("model_unavailable");
		expect(verdict.remediable).toBe(true);
	});
});

describe("classifyFailureSignature — context overflow (shrink the window, not the budget)", () => {
	it.each([
		"This model's maximum context length is 8192 tokens",
		"context window exceeded",
		"contextLengthReached",
		"The prompt is too long for the context",
		"Please reduce the length of the messages",
	])("routes %j to context_overflow / aborted / remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("context_overflow");
		expect(verdict.outcome).toBe("aborted");
		expect(verdict.remediable).toBe(true);
	});

	it("checks context_overflow BEFORE the generic token-budget rule (order is load-bearing)", () => {
		// This message contains both "context length" AND "tokens" — must classify as overflow, not token_budget.
		const verdict = classifyFailureSignature(
			"Error: maximum context length is 4096 tokens, however you requested more",
		);
		expect(verdict.signature).toBe("context_overflow");
	});
});

describe("classifyFailureSignature — token budget (truncation → raise max_tokens)", () => {
	it.each([
		"finish_reason: length",
		'stopped at max_tokens ("length")',
		"maxPredictedTokensReached",
		"output token limit hit",
		"the response was truncated",
	])("routes %j to token_budget / aborted / remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("token_budget");
		expect(verdict.outcome).toBe("aborted");
		expect(verdict.remediable).toBe(true);
	});
});

describe("classifyFailureSignature — rate limited / overloaded (back off)", () => {
	it.each([
		"HTTP 429 Too Many Requests",
		"rate limit exceeded",
		"the server is overloaded",
		"quota exceeded",
	])("routes %j to rate_limited / aborted / remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("rate_limited");
		expect(verdict.outcome).toBe("aborted");
		expect(verdict.remediable).toBe(true);
	});
});

describe("classifyFailureSignature — transient stream timeout / connection blip (re-run)", () => {
	it.each([
		"UND_ERR_BODY_TIMEOUT",
		"Body Timeout Error",
		"HeadersTimeoutError",
		"ETIMEDOUT",
		"request timed out",
		"socket hang up",
		"ECONNRESET",
		"fetch failed",
		"502 Bad Gateway",
		"503 Service Unavailable",
	])("routes %j to stream_timeout / aborted / remediable", (message) => {
		const verdict = classifyFailureSignature(new Error(message));
		expect(verdict.signature).toBe("stream_timeout");
		expect(verdict.outcome).toBe("aborted");
		expect(verdict.remediable).toBe(true);
	});

	it("reads the undici code from a nested Error `cause` (not just the top message)", () => {
		const err = new Error("fetch failed");
		(err as { cause?: unknown }).cause = new Error("UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error");
		expect(classifyFailureSignature(err).signature).toBe("stream_timeout");
	});
});

describe("classifyFailureSignature — aborted request", () => {
	it.each([
		"AbortError",
		"The operation was aborted",
		"request aborted",
		"userStopped",
		"cancelled",
	])("routes %j to aborted_request / aborted / remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("aborted_request");
		expect(verdict.outcome).toBe("aborted");
		expect(verdict.remediable).toBe(true);
	});

	it("classifies a DOMException-shaped AbortError by its name", () => {
		const err = new Error("The user aborted a request.");
		err.name = "AbortError";
		expect(classifyFailureSignature(err).signature).toBe("aborted_request");
	});
});

describe("classifyFailureSignature — content filtered / refusal (NON-remediable)", () => {
	it.each([
		"content_filter triggered",
		"blocked by the safety policy",
		"The model refused to answer",
		"I can't help with that request",
		"I'm not able to comply",
	])("routes %j to content_filtered / other_failure / NON-remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("content_filtered");
		expect(verdict.outcome).toBe("other_failure");
		expect(verdict.remediable).toBe(false);
	});
});

describe("classifyFailureSignature — malformed output (force a schema)", () => {
	it.each([
		"SyntaxError: Unexpected token < in JSON at position 0",
		"invalid json response",
		"Unexpected end of JSON input",
		"failed to parse tool arguments",
		"ZodError: does not match schema",
		"invalid arguments for tool create_card",
	])("routes %j to malformed_output / malformed / remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("malformed_output");
		expect(verdict.outcome).toBe("malformed");
		expect(verdict.remediable).toBe(true);
	});

	it("classifies a real thrown SyntaxError by its name", () => {
		let thrown: unknown;
		try {
			JSON.parse("{not valid}");
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(SyntaxError);
		expect(classifyFailureSignature(thrown).signature).toBe("malformed_output");
	});
});

describe("classifyFailureSignature — response loop", () => {
	it.each([
		"repetition loop detected",
		"the model repeated the same line",
		"looping without progress",
		"no progress",
	])("routes %j to response_loop / loop / remediable", (message) => {
		const verdict = classifyFailureSignature(message);
		expect(verdict.signature).toBe("response_loop");
		expect(verdict.outcome).toBe("loop");
		expect(verdict.remediable).toBe(true);
	});
});

describe("classifyFailureSignature — conservative unknown fallback", () => {
	it("maps an unrecognized error to unknown_error / other_failure / remediable", () => {
		const verdict = classifyFailureSignature(new Error("something weird happened that we don't recognize"));
		expect(verdict.signature).toBe("unknown_error");
		expect(verdict.outcome).toBe("other_failure");
		expect(verdict.remediable).toBe(true);
	});

	it("maps an empty/whitespace message to unknown_error (never crashes, never success)", () => {
		expect(classifyFailureSignature(new Error("   ")).signature).toBe("unknown_error");
		expect(classifyFailureSignature("").signature).toBe("unknown_error");
	});

	it("never returns a `success` outcome (a failure is never mis-read as done)", () => {
		for (const message of ["", "boom", "404", "SyntaxError", "timeout", "refused", "loop"]) {
			expect(classifyFailureSignature(message).outcome).not.toBe("success");
		}
	});
});

describe("classifyFailureSignature — error-shape extraction (never throws)", () => {
	it("reads a plain string error", () => {
		expect(classifyFailureSignature("ECONNREFUSED").signature).toBe("model_unavailable");
	});

	it("reads a `{ message }` object", () => {
		expect(classifyFailureSignature({ message: "HTTP 429 too many requests" }).signature).toBe("rate_limited");
	});

	it("reads an endpoint `{ error: string }` envelope", () => {
		expect(classifyFailureSignature({ error: "model not found" }).signature).toBe("model_unavailable");
	});

	it("reads an endpoint `{ error: { message } }` envelope", () => {
		expect(classifyFailureSignature({ error: { message: "context window exceeded" } }).signature).toBe(
			"context_overflow",
		);
	});

	it.each([null, undefined, 42, {}, [], { foo: "bar" }])("maps the non-error value %j to unknown_error", (value) => {
		expect(classifyFailureSignature(value).signature).toBe("unknown_error");
	});
});

describe("isRemediableFailure", () => {
	it("is false for a gone endpoint and a safety refusal", () => {
		expect(isRemediableFailure(new Error("connection refused"))).toBe(false);
		expect(isRemediableFailure("blocked by the safety policy")).toBe(false);
	});

	it("is true for a transient timeout, a truncation, and an unknown error", () => {
		expect(isRemediableFailure(new Error("ETIMEDOUT"))).toBe(true);
		expect(isRemediableFailure("finish_reason: length")).toBe(true);
		expect(isRemediableFailure(new Error("mystery"))).toBe(true);
	});

	it("agrees with classifyFailureSignature(...).remediable", () => {
		const cases = ["ECONNREFUSED", "context window exceeded", "invalid json", "refused", "boom"];
		for (const c of cases) {
			expect(isRemediableFailure(c)).toBe(classifyFailureSignature(c).remediable);
		}
	});
});

describe("FAILURE_SIGNATURES catalog + composition with the retry ladder", () => {
	it("every signature kind is a member of the exported catalog", () => {
		const catalog = new Set<FailureSignatureKind>(FAILURE_SIGNATURES);
		for (const message of [
			"404",
			"context length",
			"max_tokens",
			"429",
			"ETIMEDOUT",
			"AbortError",
			"refused",
			"invalid json",
			"loop detected",
			"mystery",
		]) {
			expect(catalog.has(classifyFailureSignature(message).signature)).toBe(true);
		}
	});

	it("every routed outcome is a real non-success ModelOutcomeKind with a defined retry ladder", () => {
		const failureKinds = new Set(MODEL_FAILURE_KINDS);
		for (const message of ["404", "context length", "max_tokens", "ETIMEDOUT", "invalid json", "loop", "boom"]) {
			const outcome = classifyFailureSignature(message).outcome;
			expect(failureKinds.has(outcome)).toBe(true);
			// The whole point: the routed outcome keys a real ladder the retry brain can consume.
			expect(retryLadderForOutcome(outcome).length).toBeGreaterThan(0);
		}
	});

	it("a NON-remediable signature still routes to a valid outcome (the loop decides to surface, not the classifier)", () => {
		const verdict = classifyFailureSignature("connection refused");
		expect(verdict.remediable).toBe(false);
		expect(new Set(MODEL_FAILURE_KINDS).has(verdict.outcome)).toBe(true);
	});
});
