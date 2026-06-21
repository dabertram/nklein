/**
 * User-input / first-turn content assembler.
 *
 * Opens the first user content array for a turn, loading user file contents via
 * the injected `userFileContentLoader`.
 */
import type * as LlmsProviders from "@nklein/llms";
export declare function buildInitialUserContent(userMessage: string, userImages?: string[], userFiles?: string[], userFileContentLoader?: (path: string) => Promise<string>): Promise<string | LlmsProviders.ContentBlock[]>;
/**
 * Normalize a user message shape into a plain string when possible.
 *
 * Accepts either a string or a LlmsProviders.Message; returns the best-effort
 * concatenated plain-text body. Non-text content is ignored.
 */
export declare function normalizeUserMessage(input: string | LlmsProviders.Message | undefined): string;
