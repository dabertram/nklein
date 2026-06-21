export declare function nowIso(): string;
export declare function unlinkIfExists(path: string | null | undefined): void;
export interface SessionArtifactPaths {
    messagesPath: string;
}
export declare class SessionArtifacts {
    private readonly ensureSessionsDir;
    constructor(ensureSessionsDir: () => string);
    sessionArtifactsDir(sessionId: string): string;
    ensureSessionArtifactsDir(sessionId: string): string;
    sessionMessagesPath(sessionId: string): string;
    sessionManifestPath(sessionId: string, ensureDir?: boolean): string;
    removeSessionDirIfEmpty(sessionId: string): void;
    removeSessionDir(sessionId: string): void;
    removeDir(dir: string): void;
    subagentArtifactPaths(sessionId: string, subAgentId: string, activeTeamTaskSessionId?: string): SessionArtifactPaths;
}
