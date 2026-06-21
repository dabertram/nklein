import type { HubCommandEnvelope, HubReplyEnvelope } from "@nklein/shared";
import { type HubTransportContext } from "./context";
export declare function handleClientRegister(ctx: HubTransportContext, envelope: HubCommandEnvelope): HubReplyEnvelope;
export declare function handleClientUpdate(ctx: HubTransportContext, envelope: HubCommandEnvelope): HubReplyEnvelope;
export declare function handleClientUnregister(ctx: HubTransportContext, envelope: HubCommandEnvelope, onClientRemoved: (clientId: string) => void): HubReplyEnvelope;
export declare function handleClientList(ctx: HubTransportContext, envelope: HubCommandEnvelope): HubReplyEnvelope;
