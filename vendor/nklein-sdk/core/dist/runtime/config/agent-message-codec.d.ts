import type { AgentMessage, Message, MessageWithMetadata } from "@nklein/shared";
export declare function messageToAgentMessages(message: MessageWithMetadata): AgentMessage[];
export declare function messagesToAgentMessages(messages: readonly MessageWithMetadata[]): AgentMessage[];
export declare function agentMessageToMessageWithMetadata(message: AgentMessage): MessageWithMetadata;
export declare function agentMessagesToMessagesWithMetadata(messages: readonly AgentMessage[]): MessageWithMetadata[];
export declare function agentMessagesToMessages(messages: readonly AgentMessage[]): Message[];
