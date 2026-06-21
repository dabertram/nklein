import type { ExtensionContext } from "@nklein/shared";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import type { StartSessionInput } from "../runtime/host/runtime-host";
import type { NKleinCoreStartInput } from "./types";
export declare function toNKleinCoreStartInput(input: StartSessionInput | NKleinCoreStartInput): NKleinCoreStartInput;
export interface NormalizeNKleinCoreStartInputOptions {
    defaultCapabilities?: RuntimeCapabilities;
    withExtensionContext?: (context?: ExtensionContext) => ExtensionContext | undefined;
}
export declare function normalizeNKleinCoreStartInput(input: NKleinCoreStartInput, options?: NormalizeNKleinCoreStartInputOptions): StartSessionInput;
