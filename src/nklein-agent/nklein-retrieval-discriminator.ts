import {
	buildRetrievalDiscriminatorPrompt,
	parseRetrievalDiscriminatorDecision,
} from "../core/retrieval-discriminator";
import type { LocalLlmClient } from "./nklein-local-llm-client";
import type { RetrievalDiscriminator } from "./nklein-retrieval-tools";

const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		ranked_ids: { type: "array", items: { type: "string" } },
		keep_ids: { type: "array", items: { type: "string" } },
	},
	required: ["ranked_ids", "keep_ids"],
	additionalProperties: false,
} as const;

/** Build the one-shot, same-resident-model discriminator used between bounded code search and the coding turn. */
export function createLocalModelRetrievalDiscriminator(
	client: Pick<LocalLlmClient, "complete">,
): RetrievalDiscriminator {
	return async (input) => {
		const taskAndQuery = [input.taskContext.trim(), `SEARCH QUERY: ${input.searchQuery}`]
			.filter(Boolean)
			.join("\n\n");
		const response = await client.complete({
			messages: [
				{
					role: "system",
					content: "You are a precise code-search relevance discriminator. Return only the required JSON.",
				},
				{
					role: "user",
					content: buildRetrievalDiscriminatorPrompt({ query: taskAndQuery, candidates: input.candidates }),
				},
			],
			sampling: { temperature: 0, maxTokens: 1_024 },
			format: {
				jsonSchema: { name: "retrieval_rerank", strict: true, schema: RESPONSE_SCHEMA },
			},
		});
		return parseRetrievalDiscriminatorDecision(response.content);
	};
}
