import type { NKleinCoreOptions } from "../../nklein-core/types";
import { FileSessionService } from "../../session/services/file-session-service";
import { CoreSessionService } from "../../session/services/session-service";
import type { RuntimeHost } from "./runtime-host";
export type SessionBackend = CoreSessionService | FileSessionService;
export declare function resolveSessionBackend(options: NKleinCoreOptions): Promise<SessionBackend>;
export declare function createRuntimeHost(options: NKleinCoreOptions): Promise<RuntimeHost>;
