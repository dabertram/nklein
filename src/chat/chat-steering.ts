import type { ChatPromptMessage } from "./chat-turn-context";

export type ChatTurnDeliveryMode = "queue" | "steer";

export interface ChatSteeringMessage {
	id: string;
	content: string;
	createdAt: number;
}

function renderSteeringContent(message: ChatSteeringMessage): string {
	return `User steering update received while this turn is still running:\n${message.content}`;
}

export function appendChatSteeringMessages(
	messages: readonly ChatPromptMessage[],
	steeringMessages: readonly ChatSteeringMessage[],
): ChatPromptMessage[] {
	if (steeringMessages.length === 0) {
		return [...messages];
	}
	return [
		...messages,
		...steeringMessages.map((message) => ({
			role: "user" as const,
			content: renderSteeringContent(message),
		})),
	];
}
