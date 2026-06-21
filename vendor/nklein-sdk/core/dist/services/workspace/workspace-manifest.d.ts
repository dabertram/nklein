import type { WorkspaceInfo } from "@nklein/shared";
export interface WorkspaceInfoDiagnostics {
    info: WorkspaceInfo;
    vcsType: "git" | "none";
    error?: {
        errorType: string;
        message: string;
    };
}
export interface BuiltWorkspaceMetadata {
    workspaceInfo: WorkspaceInfo;
    workspaceMetadata: string;
    durationMs: number;
    vcsType: "git" | "none";
    initError?: {
        errorType: string;
        message: string;
    };
}
export declare function normalizeWorkspacePath(workspacePath: string): string;
export declare function generateWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo>;
export declare function generateWorkspaceInfoWithDiagnostics(workspacePath: string): Promise<WorkspaceInfoDiagnostics>;
export declare function buildWorkspaceMetadata(cwd: string): Promise<string>;
/**
 * Generate workspace metadata as both a structured `WorkspaceInfo` object and
 * its pre-serialized string form.
 *
 * Use this instead of calling `buildWorkspaceMetadata` + `generateWorkspaceInfo`
 * separately so the git I/O only happens once.
 */
export declare function buildWorkspaceMetadataWithInfo(cwd: string): Promise<BuiltWorkspaceMetadata>;
