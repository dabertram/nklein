import { buildPropertyBindingPrompt, type PropertyBindingProposal } from "../core/property-binding-contract";
import type { SpecInvariant } from "../core/spec-invariant-derivation";
import type { StructuredGenerator } from "./klein-core-client";
import type {
	LocalLlmCompletionRequest,
	LocalLlmToolCompletion,
	LocalLlmToolDefinition,
} from "./nklein-local-llm-client";

const PROPERTY_BINDING_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "testCode", "rationale"],
	properties: {
		status: { type: "string", enum: ["bound", "unavailable"] },
		testCode: { type: "string", maxLength: 48_000 },
		rationale: { type: "string", minLength: 1, maxLength: 2_000 },
	},
} as const;

export interface PropertyBindingModelInput {
	readonly invariants: readonly SpecInvariant[];
	readonly scaffold: string;
	readonly patch: string;
}

export type PropertyBindingModelCaller = (
	input: PropertyBindingModelInput,
	signal?: AbortSignal,
) => Promise<PropertyBindingProposal>;

interface PropertyBindingGenerator extends StructuredGenerator {
	completeWithTools?(
		request: LocalLlmCompletionRequest,
		tools: readonly LocalLlmToolDefinition[],
		opts?: { toolChoice?: "auto" | "required" },
	): Promise<LocalLlmToolCompletion>;
}

function parseProposal(value: unknown): PropertyBindingProposal {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const rationale = typeof record.rationale === "string" ? record.rationale.trim().slice(0, 2_000) : "";
	if (record.status === "unavailable") {
		if (!rationale) throw new Error("Property binder must explain why binding is unavailable.");
		return { status: "unavailable", testCode: "", rationale };
	}
	if (record.status !== "bound" || typeof record.testCode !== "string" || !record.testCode.trim() || !rationale) {
		throw new Error("Property binder returned an invalid proposal.");
	}
	return { status: "bound", testCode: record.testCode.slice(0, 48_000), rationale };
}

/** Low-temperature, required-tool binding pass. A constrained-decoding fallback covers providers without tool calls. */
export function createPropertyBindingModelCaller(generator: PropertyBindingGenerator): PropertyBindingModelCaller {
	return async (input, signal) => {
		const messages = [
			{
				role: "system" as const,
				content:
					"You are an independent property-test binder. Translate only stated invariants into executable tests; decline when an honest binding is not supported by source evidence.",
			},
			{ role: "user" as const, content: buildPropertyBindingPrompt(input) },
		];
		const sampling = {
			temperature: 0.1,
			topP: 0.9,
			topK: 40,
			minP: 0.05,
			repetitionPenalty: 1.05,
			maxTokens: 8_192,
		};
		if (generator.completeWithTools) {
			const completion = await generator.completeWithTools(
				{ messages, sampling, signal },
				[
					{
						name: "submit_property_binding",
						description:
							"Return a bound fast-check test, or explicitly report that honest binding is unavailable.",
						parameters: PROPERTY_BINDING_SCHEMA,
					},
				],
				{ toolChoice: "required" },
			);
			const call = completion.toolCalls.find((candidate) => candidate.name === "submit_property_binding");
			if (call) {
				try {
					return parseProposal(call.arguments);
				} catch {
					// Fall back to schema-constrained reflection when native tool arguments were malformed.
				}
			}
		}
		return await generator.generateStructured({
			messages,
			jsonSchema: { name: "submit_property_binding", schema: PROPERTY_BINDING_SCHEMA, strict: true },
			parse: parseProposal,
			sampling,
			signal,
		});
	};
}
