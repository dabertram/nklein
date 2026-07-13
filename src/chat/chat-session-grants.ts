import { createCapabilityGrantStore } from "../core/capability-grants";

/**
 * F2.2 — the runtime-wide per-session capability-grant store (mirror of the F2.1 session-taint registry): the
 * chat wiring gives each turn's executor a session-scoped view, and a session's grants die with the session.
 * In-memory by design: a grant is a short-TTL convenience over an explicit confirmation, so a restart safely
 * forgetting grants only means re-confirming — fail-closed, unlike taint where forgetting would fail OPEN.
 */
export const chatSessionGrantStore = createCapabilityGrantStore();
