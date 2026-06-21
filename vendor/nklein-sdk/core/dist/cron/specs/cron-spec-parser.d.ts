import type { CronSpecParseResult, CronTriggerKind } from "@nklein/shared";
/**
 * Markdown frontmatter parser for `.nklein/cron/*.md` automation specs.
 *
 * Lives in @nklein/core because it depends on `yaml`. The spec types
 * themselves live in @nklein/shared so other packages can consume them
 * without pulling in a YAML parser.
 *
 * The parser never throws for a single bad file — it produces a
 * `CronSpecParseResult` with an `error` message so the reconciler can record
 * `parse_status='invalid'` durably instead of dropping state.
 */
export declare function inferTriggerKindFromPath(relativePath: string): CronTriggerKind;
export declare function splitFrontmatter(raw: string): {
    frontmatter: string | undefined;
    body: string;
};
export declare function computeContentHash(frontmatterJson: unknown, body: string): string;
export interface ParseCronSpecInput {
    relativePath: string;
    raw: string;
}
/**
 * Parse a single cron spec file. Never throws; always returns a result.
 */
export declare function parseCronSpecFile(input: ParseCronSpecInput): CronSpecParseResult;
