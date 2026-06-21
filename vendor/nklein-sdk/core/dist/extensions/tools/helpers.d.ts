import { type EditFileInput, type ReadFileRequest, type StructuredCommandInput } from "./schemas";
/**
 * Format an error into a string message
 */
export declare function formatError(error: unknown): string;
export declare function getEditorSizeError(input: EditFileInput): string | null;
/**
 * Create a timeout-wrapped promise
 */
export declare function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T>;
export declare function normalizeReadFileRequests(input: unknown): ReadFileRequest[];
export declare function formatReadFileQuery(request: ReadFileRequest): string;
export declare function getReadFileRangeError(request: ReadFileRequest): string | null;
export declare function normalizeRunCommandsInput(input: unknown): Array<string | StructuredCommandInput>;
export declare function formatRunCommandQuery(command: string | StructuredCommandInput): string;
