import type { ITelemetryService, WorkspaceInfo } from "@nklein/shared";
export interface WorkspaceLifecycleTelemetryInput {
    telemetry?: ITelemetryService;
    rootPath: string;
    workspaceInfo?: WorkspaceInfo;
    rootCount?: number;
    vcsType?: "git" | "none";
    vcsTypes?: ReadonlyArray<string>;
    durationMs?: number;
    initError?: {
        errorType: string;
        message: string;
    };
    featureFlagEnabled?: boolean;
    isRemoteWorkspace?: boolean;
}
export declare function emitWorkspaceLifecycleTelemetry(input: WorkspaceLifecycleTelemetryInput): void;
export declare function resetWorkspaceTelemetryForTests(): void;
