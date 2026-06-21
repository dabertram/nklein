export interface UnifiedConfigFileContext<TType extends string = string> {
    type: TType;
    directoryPath: string;
    fileName: string;
    filePath: string;
    content: string;
}
export interface UnifiedConfigFileCandidate {
    directoryPath: string;
    fileName: string;
    filePath: string;
}
export interface UnifiedConfigDefinition<TType extends string = string, TItem = unknown> {
    type: TType;
    directories: ReadonlyArray<string>;
    discoverFiles?: (directoryPath: string) => Promise<ReadonlyArray<UnifiedConfigFileCandidate>>;
    includeFile?: (fileName: string, filePath: string) => boolean;
    parseFile: (context: UnifiedConfigFileContext<TType>) => TItem;
    resolveId: (item: TItem, context: UnifiedConfigFileContext<TType>) => string;
}
export interface UnifiedConfigWatcherOptions {
    debounceMs?: number;
    emitParseErrors?: boolean;
}
export interface UnifiedConfigRecord<TType extends string = string, TItem = unknown> {
    type: TType;
    id: string;
    item: TItem;
    filePath: string;
}
export type UnifiedConfigWatcherEvent<TType extends string = string, TItem = unknown> = {
    kind: "upsert";
    record: UnifiedConfigRecord<TType, TItem>;
} | {
    kind: "remove";
    type: TType;
    id: string;
    filePath: string;
} | {
    kind: "error";
    type: TType;
    error: unknown;
    filePath?: string;
};
export declare class UnifiedConfigFileWatcher<TType extends string = string, TItem = unknown> {
    private readonly definitions;
    private readonly debounceMs;
    private readonly emitParseErrors;
    private readonly listeners;
    private readonly recordsByType;
    private readonly watchersByDirectory;
    private readonly baseTypesByDirectory;
    private watchedTypesByDirectory;
    private readonly discoveredDirectoriesByType;
    private readonly definitionsByType;
    private readonly pendingTypes;
    private flushTimer;
    private refreshQueue;
    private started;
    constructor(definitions: ReadonlyArray<UnifiedConfigDefinition<TType, TItem>>, options?: UnifiedConfigWatcherOptions);
    subscribe(listener: (event: UnifiedConfigWatcherEvent<TType, TItem>) => void): () => void;
    start(): Promise<void>;
    stop(): void;
    refreshAll(): Promise<void>;
    refreshType(type: TType): Promise<void>;
    getSnapshot(type: TType): Map<string, UnifiedConfigRecord<TType, TItem>>;
    getAllSnapshots(): Map<TType, Map<string, UnifiedConfigRecord<TType, TItem>>>;
    private emit;
    private enqueueRefresh;
    private startDirectoryWatchers;
    private syncDirectoryWatchers;
    private scheduleFlush;
    private refreshTypeInternal;
    private loadDefinition;
    private buildDesiredTypesByDirectory;
    private readDirectoryFileCandidates;
}
