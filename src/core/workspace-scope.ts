export const WORKSPACE_ID_HEADER = "x-nklein-workspace-id";
export const LEGACY_WORKSPACE_ID_HEADER = "x-kanban-workspace-id";

export function buildWorkspaceScopeHeaders(workspaceId: string | null): Record<string, string> {
	if (!workspaceId) {
		return {};
	}
	return {
		[WORKSPACE_ID_HEADER]: workspaceId,
	};
}
