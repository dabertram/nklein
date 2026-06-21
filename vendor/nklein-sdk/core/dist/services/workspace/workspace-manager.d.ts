import { type WorkspaceInfo, type WorkspaceManifest } from "@nklein/shared";
export interface WorkspaceManagerEvent {
    type: "workspace_added" | "workspace_switched";
    workspace: WorkspaceInfo;
}
export interface WorkspaceManager {
    addWorkspacePath(workspacePath: string): Promise<WorkspaceInfo>;
    switchWorkspace(workspacePath: string): Promise<WorkspaceInfo>;
    subscribe(listener: (event: WorkspaceManagerEvent) => void): () => void;
    getCurrentWorkspace(): WorkspaceInfo | undefined;
    getWorkspace(workspacePath: string): WorkspaceInfo | undefined;
    listWorkspaces(): WorkspaceInfo[];
    getManifest(): WorkspaceManifest;
}
export declare class InMemoryWorkspaceManager implements WorkspaceManager {
    private manifest;
    private readonly listeners;
    constructor(manifest?: WorkspaceManifest);
    addWorkspacePath(workspacePath: string): Promise<WorkspaceInfo>;
    switchWorkspace(workspacePath: string): Promise<WorkspaceInfo>;
    subscribe(listener: (event: WorkspaceManagerEvent) => void): () => void;
    getCurrentWorkspace(): WorkspaceInfo | undefined;
    getWorkspace(workspacePath: string): WorkspaceInfo | undefined;
    listWorkspaces(): WorkspaceInfo[];
    getManifest(): WorkspaceManifest;
    private emit;
}
