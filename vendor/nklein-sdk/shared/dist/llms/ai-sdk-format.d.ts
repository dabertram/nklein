export type AiSdkFormatterMessageRole = "user" | "assistant" | "tool";
export type AiSdkFormatterPart = {
    type: "text";
    text: string;
} | {
    type: "reasoning";
    text: string;
    providerOptions?: Record<string, Record<string, unknown>>;
} | {
    type: "image";
    image: string | Uint8Array | ArrayBuffer | URL;
    mediaType?: string;
} | {
    type: "file";
    path: string;
    content: string;
} | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerOptions?: Record<string, Record<string, unknown>>;
} | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError?: boolean;
};
export interface AiSdkFormatterMessage {
    role: AiSdkFormatterMessageRole;
    content: string | AiSdkFormatterPart[];
}
export type AiSdkMessagePart = Record<string, unknown>;
export type AiSdkMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | AiSdkMessagePart[];
};
export declare function toAiSdkToolResultOutput(output: unknown, isError?: boolean): Record<string, unknown>;
export declare function formatMessagesForAiSdk(systemContent: string | AiSdkMessagePart[] | undefined, messages: readonly AiSdkFormatterMessage[], options?: {
    assistantToolCallArgKey?: "args" | "input";
}): AiSdkMessage[];
