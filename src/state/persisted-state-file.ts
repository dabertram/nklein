import type { z } from "zod";

import { formatSchemaIssues } from "./schema-issue-formatting";

/**
 * Parse a persisted state file's raw content against its schema, extracted from workspace-state.
 *
 * Returns `defaultValue` when the file was absent (`raw === null`); otherwise validates against the
 * schema and returns the parsed data, or throws a "fix or remove the file" error that names the file
 * and lists the formatted schema issues. Pure — the caller does the I/O and passes the parsed JSON.
 */
export function parsePersistedStateFile<T>(
	filePath: string,
	fileLabel: string,
	raw: unknown | null,
	schema: z.ZodType<T>,
	defaultValue: T,
): T {
	if (raw === null) {
		return defaultValue;
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Invalid ${fileLabel} file at ${filePath}. ` +
				`Fix or remove the file. Validation errors: ${formatSchemaIssues(parsed.error)}`,
		);
	}
	return parsed.data;
}
