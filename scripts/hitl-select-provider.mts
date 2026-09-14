/**
 * Point a runtime HOME at a HITL model server as its selected OpenAI-compatible provider.
 *
 *   HOME=<arm home> HITL_BASE_URL=http://127.0.0.1:8096/v1 HITL_MODEL_ID=claude-sonnet-hitl npx tsx scripts/hitl-select-provider.mts
 *
 * Parameterized version of factory-drains/bin/hitl-select-openai-compatible.mts (which hardcodes :8095/claude-hitl).
 */
import { writeKanbanSelectedProviderId } from "../src/nklein-agent/nklein-provider-selection-store";
import { getSdkProviderSettings, saveSdkProviderSettings } from "../src/nklein-agent/sdk-provider-boundary";

const baseUrl = process.env.HITL_BASE_URL ?? "http://127.0.0.1:8095/v1";
const modelId = process.env.HITL_MODEL_ID ?? "claude-hitl";
saveSdkProviderSettings({ settings: { provider: "openai-compatible", baseUrl, model: modelId }, tokenSource: "manual", setLastUsed: true });
writeKanbanSelectedProviderId("openai-compatible");
console.log("selected:", JSON.stringify(getSdkProviderSettings("openai-compatible")));
