import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

/**
 * §5.U — the persisted "which provider did the user pick?" store extracted from `nklein-provider-service`. A single JSON
 * file under the runtime home (overridable via `KANBAN_NKLEIN_PROVIDER_SELECTION_PATH`) holding one `{ providerId }`.
 * Reads are tolerant (missing/garbage ⇒ null); writes are atomic-enough (mkdir -p + write). Isolated for testability.
 */

const KANBAN_PROVIDER_SELECTION_SCHEMA = z.object({
	providerId: z.string().min(1),
});

/** The path of the provider-selection file — the env override if set, else `nklein-provider-selection.json` under home. */
export function getKanbanProviderSelectionPath(): string {
	return (
		process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH?.trim() ||
		join(resolveNkleinRuntimeHomePath(homedir()), "nklein-provider-selection.json")
	);
}

/** The persisted selected provider id (trimmed, lowercased), or null when the file is missing / malformed / blank. */
export function readKanbanSelectedProviderId(): string | null {
	try {
		const parsedJson = JSON.parse(readFileSync(getKanbanProviderSelectionPath(), "utf8")) as unknown;
		const parsed = KANBAN_PROVIDER_SELECTION_SCHEMA.safeParse(parsedJson);
		if (!parsed.success) {
			return null;
		}
		const providerId = parsed.data.providerId.trim().toLowerCase();
		return providerId.length > 0 ? providerId : null;
	} catch {
		return null;
	}
}

/** Persist the selected provider id, creating the parent directory as needed. */
export function writeKanbanSelectedProviderId(providerId: string): void {
	const selectionPath = getKanbanProviderSelectionPath();
	mkdirSync(dirname(selectionPath), { recursive: true });
	writeFileSync(selectionPath, `${JSON.stringify({ providerId }, null, 2)}\n`, "utf8");
}
