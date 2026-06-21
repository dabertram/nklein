import type { CoreSessionEvent } from "../../../types/events";
import { type HubTransportContext } from "./context";
/**
 * Translates internal `CoreSessionEvent`s emitted by the session host into the
 * outward-facing `HubEventEnvelope` stream.
 */
export declare function projectSessionEvent(ctx: HubTransportContext, event: CoreSessionEvent): Promise<void>;
