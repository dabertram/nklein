// §5.U cohesive extraction (2026-07-07): the session LAUNCH-CONFIG persist/read concern, lifted out of
// `nklein-session-runtime.ts`. It reads a launch config back from an SDK session record's metadata (for restart) and
// projects a start request into the persisted shape. Pure over its inputs; the shared record-reader helpers already
// live in sibling modules. The `StartNKleinSessionRuntimeRequest` import is TYPE-ONLY (erased at runtime), so there is
// no runtime import cycle with the runtime module (runtime → this module only).
import type { RuntimeNKleinReasoningEffort } from "../core/api-contract";
import { readOptionalNumber, readOptionalReasoningEffort, readOptionalString } from "./nklein-session-record-readers";
import type { StartNKleinSessionRuntimeRequest } from "./nklein-session-runtime";
import { asRecord } from "./nklein-value-guards";
import type { NKleinSdkSessionRecord } from "./sdk-runtime-boundary";

export const KANBAN_SESSION_METADATA_KEY = "kanban";

export interface NKleinPersistedLaunchConfig {
	providerId: string;
	modelId: string;
	workspaceRoot?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
}

export function readKanbanLaunchConfigFromSessionRecord(
	record: NKleinSdkSessionRecord,
): NKleinPersistedLaunchConfig | null {
	const metadata = asRecord(record.metadata);
	const kanban = asRecord(metadata?.[KANBAN_SESSION_METADATA_KEY]);
	const launchConfig = asRecord(kanban?.launchConfig);
	if (!launchConfig) {
		return null;
	}
	const providerId = readOptionalString(launchConfig, "providerId")?.trim().toLowerCase();
	const modelId = readOptionalString(launchConfig, "modelId")?.trim();
	if (!providerId || !modelId) {
		return null;
	}
	return {
		providerId,
		modelId,
		...(readOptionalString(launchConfig, "workspaceRoot") !== undefined
			? { workspaceRoot: readOptionalString(launchConfig, "workspaceRoot") }
			: {}),
		...(readOptionalString(launchConfig, "baseUrl") !== undefined
			? { baseUrl: readOptionalString(launchConfig, "baseUrl") }
			: {}),
		...(readOptionalReasoningEffort(launchConfig, "reasoningEffort") !== undefined
			? { reasoningEffort: readOptionalReasoningEffort(launchConfig, "reasoningEffort") }
			: {}),
		...(readOptionalNumber(launchConfig, "contextWindow") !== undefined
			? { contextWindow: readOptionalNumber(launchConfig, "contextWindow") }
			: {}),
		...(readOptionalNumber(launchConfig, "maxAgentWritableFileLines") !== undefined
			? { maxAgentWritableFileLines: readOptionalNumber(launchConfig, "maxAgentWritableFileLines") }
			: {}),
		...(readOptionalNumber(launchConfig, "apiTimeoutMs") !== undefined
			? { apiTimeoutMs: readOptionalNumber(launchConfig, "apiTimeoutMs") }
			: {}),
		...(readOptionalNumber(launchConfig, "turnTimeoutMs") !== undefined
			? { turnTimeoutMs: readOptionalNumber(launchConfig, "turnTimeoutMs") }
			: {}),
	};
}

export function toPersistedLaunchConfig(request: StartNKleinSessionRuntimeRequest): NKleinPersistedLaunchConfig {
	return {
		providerId: request.providerId.trim().toLowerCase(),
		modelId: request.modelId.trim(),
		...(request.workspaceRoot !== undefined ? { workspaceRoot: request.workspaceRoot?.trim() || null } : {}),
		...(request.baseUrl !== undefined ? { baseUrl: request.baseUrl?.trim() || null } : {}),
		...(request.reasoningEffort !== undefined ? { reasoningEffort: request.reasoningEffort } : {}),
		...(request.contextWindow !== undefined ? { contextWindow: request.contextWindow } : {}),
		...(request.maxAgentWritableFileLines !== undefined
			? { maxAgentWritableFileLines: request.maxAgentWritableFileLines }
			: {}),
		...(request.apiTimeoutMs !== undefined ? { apiTimeoutMs: request.apiTimeoutMs } : {}),
		...(request.turnTimeoutMs !== undefined ? { turnTimeoutMs: request.turnTimeoutMs } : {}),
	};
}
