/**
 * Apply Patch parser and patch model types.
 *
 * This parser supports the NKlein apply_patch format used by the legacy runtime.
 */
export declare const PATCH_MARKERS: {
    readonly BEGIN: "*** Begin Patch";
    readonly END: "*** End Patch";
    readonly ADD: "*** Add File: ";
    readonly UPDATE: "*** Update File: ";
    readonly DELETE: "*** Delete File: ";
    readonly MOVE: "*** Move to: ";
    readonly SECTION: "@@";
    readonly END_FILE: "*** End of File";
};
export declare const BASH_WRAPPERS: readonly ["%%bash", "apply_patch", "EOF", "```"];
export declare enum PatchActionType {
    ADD = "add",
    DELETE = "delete",
    UPDATE = "update"
}
export interface PatchChunk {
    origIndex: number;
    delLines: string[];
    insLines: string[];
}
export interface PatchAction {
    type: PatchActionType;
    newFile?: string;
    chunks: PatchChunk[];
    movePath?: string;
}
export interface PatchWarning {
    path: string;
    chunkIndex?: number;
    message: string;
    context?: string;
}
export interface Patch {
    actions: Record<string, PatchAction>;
    warnings?: PatchWarning[];
}
export declare class DiffError extends Error {
    constructor(message: string);
}
export declare class PatchParser {
    private readonly lines;
    private readonly currentFiles;
    private patch;
    private index;
    private fuzz;
    private currentPath?;
    constructor(lines: string[], currentFiles: Record<string, string>);
    parse(): {
        patch: Patch;
        fuzz: number;
    };
    private addWarning;
    private skipBeginSentinel;
    private hasMoreLines;
    private isEndMarker;
    private parseNextAction;
    private checkDuplicate;
    private parseUpdate;
    private parseUpdateFile;
    private parseDelete;
    private parseAdd;
}
