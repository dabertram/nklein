export declare const SESSION_STATUSES: readonly ["running", "completed", "failed", "cancelled"];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export declare const SessionSource: {
    readonly CORE: "core";
    readonly CLI: "cli";
    readonly SUBAGENT: "subagent";
    readonly DESKTOP: "desktop";
    readonly KANBAN: "kanban";
    readonly API: "api";
    readonly WEB: "web";
    readonly VSCODE: "vscode";
    readonly ENTERPRISE: "enterprise";
    readonly IDE: "ide";
    readonly JETBRAINS: "jetbrains";
    readonly NEOVIM: "neovim";
    readonly UNKNOWN: "unknown";
};
export type BuiltinSessionSource = (typeof SessionSource)[keyof typeof SessionSource];
export type SessionSource = BuiltinSessionSource | (string & {});
