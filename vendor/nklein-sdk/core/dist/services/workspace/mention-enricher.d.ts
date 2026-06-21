import { type FastFileIndexOptions } from "./file-indexer";
export interface MentionEnricherOptions extends FastFileIndexOptions {
    maxFiles?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
}
export interface MentionEnrichmentResult {
    prompt: string;
    mentions: string[];
    matchedFiles: string[];
    ignoredMentions: string[];
}
export declare function enrichPromptWithMentions(input: string, cwd: string, options?: MentionEnricherOptions): Promise<MentionEnrichmentResult>;
