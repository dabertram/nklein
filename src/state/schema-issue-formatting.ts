import type { ZodError } from "zod";

/**
 * Format a Zod issue path into a readable dotted string, extracted from workspace-state. Pure.
 *
 * An empty path (a root-level issue) reads as `"root"`; numeric segments (array indices) render as
 * `[n]` and string segments as themselves, joined by `.` — e.g. `["board","columns",0,"id"]` →
 * `board.columns.[0].id`.
 */
export function formatSchemaIssuePath(pathSegments: PropertyKey[]): string {
	if (pathSegments.length === 0) {
		return "root";
	}
	return pathSegments
		.map((segment) => {
			if (typeof segment === "number") {
				return `[${segment}]`;
			}
			return String(segment);
		})
		.join(".");
}

/** Format every issue in a {@link ZodError} as `path: message`, joined by `; `. Pure. */
export function formatSchemaIssues(error: ZodError): string {
	return error.issues.map((issue) => `${formatSchemaIssuePath(issue.path)}: ${issue.message}`).join("; ");
}
