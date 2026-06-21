import type { WorkspaceContext } from "../extensions/context";
import type { WorkspaceInfo } from "../session/workspace";
export declare function processWorkspaceInfo(info: WorkspaceInfo): string;
/**
 * Options for building the NKlein system prompt.
 *
 * Extends WorkspaceContext so callers can spread an ExtensionContext.workspace
 * directly. `workspaceRoot` is accepted as an alias for `rootPath` to support
 * existing call sites that set it explicitly.
 */
export interface NKleinSystemPromptOptions extends Omit<WorkspaceContext, "rootPath"> {
    /**
     * Workspace root path. Accepts either `rootPath` (from WorkspaceContext/WorkspaceInfo)
     * or `workspaceRoot` (legacy alias) — whichever is provided will be used.
     */
    rootPath?: string;
    /** Alias for rootPath — kept for backwards compatibility with existing call sites */
    workspaceRoot?: string;
    /** Per-request system prompt override */
    overridePrompt?: string;
    /** Provider ID — used to gate NKlein-specific metadata injection */
    providerId?: string;
}
export declare function buildNKleinSystemPrompt(options: NKleinSystemPromptOptions): string;
