import type { RuntimeBuilder, RuntimeBuilderInput, BuiltRuntime as RuntimeEnvironment } from "./session-runtime";
export declare function createTeamName(): string;
export declare class DefaultRuntimeBuilder implements RuntimeBuilder {
    private readonly teamRuntimeEntries;
    build(input: RuntimeBuilderInput): Promise<RuntimeEnvironment>;
}
