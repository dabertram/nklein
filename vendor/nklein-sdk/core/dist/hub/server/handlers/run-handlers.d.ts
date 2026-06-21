import type { HubCommandEnvelope, HubReplyEnvelope } from "@nklein/shared";
import { type HubTransportContext } from "./context";
export declare function handleSessionInput(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleRunAbort(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionHook(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
